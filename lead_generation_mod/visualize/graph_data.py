from __future__ import annotations

from collections import defaultdict
from itertools import combinations
from pathlib import Path
from typing import Any
import hashlib
import json
import re


STATUS_PRIORITY = {
    "accepted": 3,
    "needs_review": 2,
    "dropped": 1,
}
MAX_AGGREGATE_PERSON_NODES = 2500
MAX_AGGREGATE_QUERY_OVERLAP_EDGES = 25000


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def run_ids(data_dir: Path) -> list[str]:
    runs_dir = data_dir / "runs"
    if not runs_dir.exists():
        return []
    return sorted([path.name for path in runs_dir.iterdir() if path.is_dir()], reverse=True)


def load_artifact(data_dir: Path, run_id: str, artifact_name: str) -> Any:
    path = data_dir / "runs" / run_id / f"{artifact_name}.json"
    if not path.exists():
        raise FileNotFoundError(f"Missing artifact: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def latest_run_id(data_dir: Path) -> str:
    runs = run_ids(data_dir)
    if not runs:
        raise FileNotFoundError(f"No run artifacts found in {data_dir}")
    return runs[0]


def person_key(candidate: dict[str, Any]) -> str:
    linkedin = candidate.get("linkedin_url")
    if linkedin:
        return f"linkedin::{linkedin.lower().strip()}"
    exa_entity = candidate.get("exa_entity_id")
    if exa_entity:
        return f"entity::{exa_entity}"
    return (
        "fallback::"
        + normalize_text(candidate.get("full_name"))
        + "::"
        + normalize_text(candidate.get("current_company"))
    )


def person_node_id(pkey: str) -> str:
    digest = hashlib.sha1(pkey.encode("utf-8")).hexdigest()[:12]
    return f"person:{digest}"


def merge_status(left: str, right: str) -> str:
    return left if STATUS_PRIORITY.get(left, 0) >= STATUS_PRIORITY.get(right, 0) else right


def query_short_label(query: dict[str, Any]) -> str:
    vector_id = str(query.get("vector_id") or "query")
    return f"Q{vector_id}" if vector_id.isdigit() else vector_id.replace("_", " ").title()


def query_display_label(query: dict[str, Any]) -> str:
    name = query.get("vector_name", "").replace("_", " ").strip()
    title = " ".join(word.capitalize() for word in name.split())
    short_label = query_short_label(query)
    return f"{short_label} {title}".strip()


def run_display_label(seed_person: dict[str, Any]) -> str:
    person = seed_person.get("person_name") or "Unknown seed"
    company = seed_person.get("company_name") or "Unknown company"
    return f"{person} @ {company}"


def run_color(run_id: str) -> str:
    hue = int(hashlib.sha1(run_id.encode("utf-8")).hexdigest()[:8], 16) % 360
    return f"hsl({hue} 68% 66%)"


def query_color(run_id: str) -> str:
    hue = (int(hashlib.sha1(run_id.encode("utf-8")).hexdigest()[:8], 16) + 32) % 360
    return f"hsl({hue} 72% 72%)"


def load_current_database(data_dir: Path) -> list[dict[str, Any]]:
    leads_path = data_dir / "leads.json"
    if not leads_path.exists():
        return []
    payload = json.loads(leads_path.read_text(encoding="utf-8"))
    return payload if isinstance(payload, list) else []


def load_pre_run_database(data_dir: Path, run_id: str) -> tuple[list[dict[str, Any]], str]:
    artifact_path = data_dir / "runs" / run_id / "pre_run_database.json"
    if artifact_path.exists():
        payload = json.loads(artifact_path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            return payload, str(artifact_path)
    return load_current_database(data_dir), str(data_dir / "leads.json")


def build_graph_payload(data_dir: Path, run_id: str | None = None) -> dict[str, Any]:
    resolved_run_id = run_id or latest_run_id(data_dir)
    queries = load_artifact(data_dir, resolved_run_id, "queries")
    filter_decisions = load_artifact(data_dir, resolved_run_id, "filter_decisions")
    batch = load_artifact(data_dir, resolved_run_id, "batch")
    run_summary = load_artifact(data_dir, resolved_run_id, "run_summary")

    seed_person = batch["seed_person"]
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    seed_id = "seed"
    nodes.append(
        {
            "id": seed_id,
            "type": "seed",
            "label": seed_person["person_name"],
            "subtitle": f"{seed_person['role']} @ {seed_person['company_name']}",
            "role": seed_person["role"],
            "company": seed_person["company_name"],
            "linkedin_url": seed_person.get("linkedin_url"),
        }
    )

    query_counts: dict[str, dict[str, int]] = defaultdict(lambda: {"accepted": 0, "needs_review": 0, "dropped": 0})
    query_map: dict[str, dict[str, Any]] = {}
    person_nodes: dict[str, dict[str, Any]] = {}
    person_query_edges: set[tuple[str, str]] = set()
    person_query_sources: dict[str, set[str]] = defaultdict(set)
    person_status_reasons: dict[str, set[str]] = defaultdict(set)

    for query in queries:
        query_id = f"query:{query['vector_id']}"
        query_map[query["vector_id"]] = query
        nodes.append(
            {
                "id": query_id,
                "type": "query",
                "label": query_short_label(query),
                "title": query_display_label(query),
                "query_text": query["query_text"],
                "target_bucket": query["target_bucket"],
                "template_file": query["template_file"],
                "vector_id": query["vector_id"],
            }
        )
        edges.append(
            {
                "id": f"edge:{seed_id}:{query_id}",
                "source": seed_id,
                "target": query_id,
                "type": "seed-query",
            }
        )

    for decision in filter_decisions:
        status = decision["status"]
        candidate = decision["candidate"]
        vector_id = candidate["source_vector_id"]
        query_counts[vector_id][status] += 1

        pkey = person_key(candidate)
        query_id = f"query:{vector_id}"
        node_id = person_node_id(pkey)
        reason_list = decision.get("reasons") or []

        existing = person_nodes.get(pkey)
        if existing is None:
            same_company = normalize_text(candidate.get("current_company")) == normalize_text(seed_person["company_name"])
            person_nodes[pkey] = {
                "id": node_id,
                "type": "person",
                "label": candidate.get("full_name") or "Unknown Person",
                "subtitle": candidate.get("current_title") or "",
                "company": candidate.get("current_company"),
                "location": candidate.get("resolved_location"),
                "linkedin_url": candidate.get("linkedin_url"),
                "years_at_current_role": candidate.get("years_at_current_role"),
                "status": status,
                "same_company": same_company,
                "source_buckets": [candidate.get("source_bucket")],
                "query_ids": [vector_id],
                "query_titles": [query_display_label(query_map[vector_id])],
                "reasons": list(reason_list),
                "current_role_count": candidate.get("current_role_count"),
            }
        else:
            existing["status"] = merge_status(existing["status"], status)
            if vector_id not in existing["query_ids"]:
                existing["query_ids"].append(vector_id)
                existing["query_titles"].append(query_display_label(query_map[vector_id]))
            source_bucket = candidate.get("source_bucket")
            if source_bucket and source_bucket not in existing["source_buckets"]:
                existing["source_buckets"].append(source_bucket)
            person_status_reasons[pkey].update(reason_list)

        person_query_sources[pkey].add(vector_id)
        person_status_reasons[pkey].update(reason_list)
        person_query_edges.add((query_id, node_id))

    for pkey, node in person_nodes.items():
        node["query_count"] = len(person_query_sources[pkey])
        node["reasons"] = sorted(person_status_reasons[pkey])
        nodes.append(node)

    for query_id, person_id in sorted(person_query_edges):
        edges.append(
            {
                "id": f"edge:{query_id}:{person_id}",
                "source": query_id,
                "target": person_id,
                "type": "query-person",
            }
        )

    query_stats = []
    for query in queries:
        stats = query_counts[query["vector_id"]]
        query_stats.append(
            {
                "vector_id": query["vector_id"],
                "label": query_display_label(query),
                "accepted": stats["accepted"],
                "needs_review": stats["needs_review"],
                "dropped": stats["dropped"],
                "total": sum(stats.values()),
            }
        )

    return {
        "run_id": resolved_run_id,
        "mode": "single_run",
        "seed_person": seed_person,
        "summary": run_summary,
        "stats": {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "query_count": len(queries),
            "person_count": len(person_nodes),
            "query_breakdown": query_stats,
        },
        "nodes": nodes,
        "edges": edges,
    }


def build_aggregate_graph_payload(data_dir: Path) -> dict[str, Any]:
    resolved_run_ids = sorted(run_ids(data_dir))
    if not resolved_run_ids:
        raise FileNotFoundError(f"No run artifacts found in {data_dir / 'runs'}")

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    run_summaries: list[dict[str, Any]] = []
    person_nodes: dict[str, dict[str, Any]] = {}
    seed_node_index: dict[str, dict[str, Any]] = {}
    query_seed_origin_edges: set[tuple[str, str]] = set()
    person_query_sources: dict[str, set[str]] = defaultdict(set)
    person_run_sources: dict[str, set[str]] = defaultdict(set)
    person_status_reasons: dict[str, set[str]] = defaultdict(set)
    seed_person_keys: dict[str, str] = {}
    query_people: dict[str, set[str]] = defaultdict(set)
    query_counts: dict[str, dict[str, int]] = defaultdict(lambda: {"accepted": 0, "needs_review": 0, "dropped": 0})
    query_node_index: dict[str, dict[str, Any]] = {}
    run_indexes = {run_id: index for index, run_id in enumerate(resolved_run_ids)}
    seed_node_ids: dict[str, str] = {}

    for run_id in resolved_run_ids:
        queries = load_artifact(data_dir, run_id, "queries")
        filter_decisions = load_artifact(data_dir, run_id, "filter_decisions")
        batch = load_artifact(data_dir, run_id, "batch")
        seed_person = batch["seed_person"]
        run_index = run_indexes[run_id]
        seed_id = f"s:{run_index}"
        seed_node_ids[run_id] = seed_id
        search_label = run_display_label(seed_person)
        search_color = run_color(run_id)
        seed_person_candidate = {
            "full_name": seed_person.get("person_name"),
            "current_company": seed_person.get("company_name"),
            "linkedin_url": seed_person.get("linkedin_url"),
        }
        seed_person_keys[run_id] = person_key(seed_person_candidate)
        run_summaries.append(
            {
                "run_id": run_id,
                "run_index": run_index,
                "run_label": search_label,
                "run_color": search_color,
                "query_color": query_color(run_id),
            }
        )

        nodes.append(
            {
                "id": seed_id,
                "type": "seed",
                "label": seed_person["person_name"],
                "title": seed_person["person_name"],
                "subtitle": f"{seed_person['role']} @ {seed_person['company_name']}",
                "role": seed_person["role"],
                "company": seed_person["company_name"],
                "linkedin_url": seed_person.get("linkedin_url"),
                "run_id": run_id,
                "run_index": run_index,
                "derived_from_search": False,
                "derived_from_query_titles": [],
            }
        )
        seed_node_index[run_id] = nodes[-1]

        query_map = {query["vector_id"]: query for query in queries}
        for query in queries:
            query_id = f"q:{run_index}:{query['vector_id']}"
            query_key = f"{run_id}:{query['vector_id']}"
            nodes.append(
                {
                    "id": query_id,
                    "type": "query",
                    "label": query_short_label(query),
                    "title": query_display_label(query),
                    "target_bucket": query["target_bucket"],
                    "template_file": query["template_file"],
                    "vector_id": query["vector_id"],
                    "run_id": run_id,
                    "run_index": run_index,
                }
            )
            query_node_index[query_id] = nodes[-1]
            query_people[query_id]
            edges.append(
                {
                    "id": f"edge:{seed_id}:{query_id}",
                    "source": seed_id,
                    "target": query_id,
                    "type": "seed-query",
                    "run_index": run_index,
                }
            )

        for decision in filter_decisions:
            status = decision["status"]
            candidate = decision["candidate"]
            vector_id = candidate["source_vector_id"]
            query_key = f"{run_id}:{vector_id}"
            query_counts[query_key][status] += 1

            pkey = person_key(candidate)
            query_id = f"q:{run_index}:{vector_id}"
            node_id = person_node_id(pkey)
            reason_list = decision.get("reasons") or []
            existing = person_nodes.get(pkey)
            same_company = normalize_text(candidate.get("current_company")) == normalize_text(seed_person["company_name"])

            if existing is None:
                person_nodes[pkey] = {
                    "id": node_id,
                    "type": "person",
                    "label": candidate.get("full_name") or "Unknown Person",
                    "title": candidate.get("full_name") or "Unknown Person",
                    "subtitle": candidate.get("current_title") or "",
                    "company": candidate.get("current_company"),
                    "location": candidate.get("resolved_location"),
                    "linkedin_url": candidate.get("linkedin_url"),
                    "years_at_current_role": candidate.get("years_at_current_role"),
                    "status": status,
                    "same_company": same_company,
                    "source_buckets": [candidate.get("source_bucket")],
                    "query_ids": [query_key],
                    "query_titles": [f"{run_id} • {query_display_label(query_map[vector_id])}"],
                    "run_ids": [run_id],
                    "reasons": list(reason_list),
                    "current_role_count": candidate.get("current_role_count"),
                    "seed_run_ids": [],
                }
            else:
                existing["status"] = merge_status(existing["status"], status)
                if query_key not in existing["query_ids"]:
                    existing["query_ids"].append(query_key)
                    existing["query_titles"].append(f"{run_id} • {query_display_label(query_map[vector_id])}")
                if run_id not in existing["run_ids"]:
                    existing["run_ids"].append(run_id)
                source_bucket = candidate.get("source_bucket")
                if source_bucket and source_bucket not in existing["source_buckets"]:
                    existing["source_buckets"].append(source_bucket)
                existing["same_company"] = existing["same_company"] or same_company
                person_status_reasons[pkey].update(reason_list)

            query_people[query_id].add(pkey)
            person_query_sources[pkey].add(query_id)
            person_run_sources[pkey].add(run_id)
            person_status_reasons[pkey].update(reason_list)

    for run_id, seed_pkey in seed_person_keys.items():
        person_node = person_nodes.get(seed_pkey)
        if person_node is None:
            continue
        person_node["seed_run_ids"].append(run_id)
        derived_titles = []
        for query_key, title in zip(person_node["query_ids"], person_node["query_titles"], strict=False):
            source_run_id, source_vector_id = query_key.rsplit(":", 1)
            # Aggregate runs are indexed oldest-first, so only an earlier search can produce a later seed.
            if run_indexes[source_run_id] < run_indexes[run_id]:
                derived_titles.append(title)
                source_query_id = f"q:{run_indexes[source_run_id]}:{source_vector_id}"
                query_seed_origin_edges.add((source_query_id, seed_node_ids[run_id]))
        seed_node = seed_node_index.get(run_id)
        if seed_node is not None and derived_titles:
            seed_node["derived_from_search"] = True
            seed_node["derived_from_query_titles"] = sorted(set(derived_titles))

    query_overlap_counts: dict[tuple[str, str], int] = defaultdict(int)
    for query_ids in person_query_sources.values():
        for left_query_id, right_query_id in combinations(sorted(query_ids), 2):
            query_overlap_counts[(left_query_id, right_query_id)] += 1

    eligible_person_keys: set[str] = set()
    for pkey, node in person_nodes.items():
        is_shared = len(person_query_sources[pkey]) >= 3
        is_seed_linked = bool(node["seed_run_ids"])
        if is_shared or is_seed_linked:
            eligible_person_keys.add(pkey)

    ranked_person_keys = sorted(
        eligible_person_keys,
        key=lambda pkey: (
            not bool(person_nodes[pkey]["seed_run_ids"]),
            -len(person_run_sources[pkey]),
            -len(person_query_sources[pkey]),
            person_nodes[pkey]["label"],
        ),
    )
    visible_person_keys = set(ranked_person_keys[:MAX_AGGREGATE_PERSON_NODES])

    for pkey, node in person_nodes.items():
        node["query_count"] = len(person_query_sources[pkey])
        node["run_count"] = len(person_run_sources[pkey])
        node["run_colors"] = [run_color(run_id) for run_id in sorted(person_run_sources[pkey])]
        node["reasons"] = sorted(person_status_reasons[pkey])
        node["seed_run_ids"] = sorted(set(node["seed_run_ids"]))
        if pkey in visible_person_keys:
            nodes.append(node)

    for query_id, members in query_people.items():
        visible_count = 0
        for pkey in members:
            if pkey in visible_person_keys:
                visible_count += 1
                edges.append(
                    {
                        "id": f"edge:{query_id}:{person_node_id(pkey)}",
                        "source": query_id,
                        "target": person_node_id(pkey),
                        "type": "query-person",
                    }
                )
        query_node = query_node_index[query_id]
        query_node["produced_people_count"] = len(members)
        query_node["visible_person_count"] = visible_count
        query_node["hidden_person_count"] = len(members) - visible_count

    ranked_query_overlaps = sorted(
        query_overlap_counts.items(),
        key=lambda item: (-item[1], item[0][0], item[0][1]),
    )
    visible_query_overlaps = ranked_query_overlaps[:MAX_AGGREGATE_QUERY_OVERLAP_EDGES]
    for (left_query_id, right_query_id), intersection_count in visible_query_overlaps:
        edges.append(
            {
                "id": f"overlap:{left_query_id}:{right_query_id}",
                "source": left_query_id,
                "target": right_query_id,
                "type": "query-overlap",
                "intersection_count": intersection_count,
            }
        )

    for query_id, seed_id in sorted(query_seed_origin_edges):
        edges.append(
            {
                "id": f"edge:{query_id}:{seed_id}:seed-origin",
                "source": query_id,
                "target": seed_id,
                "type": "query-seed-origin",
            }
        )

    query_stats = []
    for run_id in resolved_run_ids:
        queries = load_artifact(data_dir, run_id, "queries")
        for query in queries:
            query_key = f"{run_id}:{query['vector_id']}"
            stats = query_counts[query_key]
            query_stats.append(
                {
                    "run_id": run_id,
                    "vector_id": query["vector_id"],
                    "label": query_display_label(query),
                    "accepted": stats["accepted"],
                    "needs_review": stats["needs_review"],
                    "dropped": stats["dropped"],
                    "total": sum(stats.values()),
                }
            )

    recursive_seed_links = len(query_seed_origin_edges)
    cross_run_people = sum(1 for node in person_nodes.values() if len(node["run_ids"]) > 1)

    return {
        "run_id": "all_runs",
        "mode": "aggregate",
        "summary": {
            "run_count": len(resolved_run_ids),
            "recursive_seed_link_count": recursive_seed_links,
            "cross_run_people_count": cross_run_people,
            "runs": run_summaries,
        },
        "stats": {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "seed_count": len(resolved_run_ids),
            "query_count": sum(1 for node in nodes if node["type"] == "query"),
            "person_count": len(visible_person_keys),
            "unique_people_count": len(person_nodes),
            "hidden_person_count": len(person_nodes) - len(visible_person_keys),
            "eligible_shared_person_count": len(eligible_person_keys),
            "omitted_shared_person_count": len(eligible_person_keys - visible_person_keys),
            "person_node_limit": MAX_AGGREGATE_PERSON_NODES,
            "query_overlap_edge_count": len(visible_query_overlaps),
            "positive_query_overlap_count": len(query_overlap_counts),
            "omitted_query_overlap_count": len(query_overlap_counts) - len(visible_query_overlaps),
            "query_overlap_edge_limit": MAX_AGGREGATE_QUERY_OVERLAP_EDGES,
            "query_breakdown": query_stats,
        },
        "nodes": nodes,
        "edges": edges,
    }


def build_query_results_payload(data_dir: Path, run_id: str, vector_id: str) -> dict[str, Any]:
    queries = load_artifact(data_dir, run_id, "queries")
    filter_decisions = load_artifact(data_dir, run_id, "filter_decisions")
    query = next((item for item in queries if str(item.get("vector_id")) == vector_id), None)
    if query is None:
        raise FileNotFoundError(f"Query '{vector_id}' not found in run '{run_id}'")

    people: dict[str, dict[str, Any]] = {}
    for decision in filter_decisions:
        candidate = decision.get("candidate") or {}
        if str(candidate.get("source_vector_id")) != vector_id:
            continue
        pkey = person_key(candidate)
        people[pkey] = {
            "full_name": candidate.get("full_name") or "Unknown Person",
            "current_title": candidate.get("current_title") or "",
            "current_company": candidate.get("current_company") or "",
            "linkedin_url": candidate.get("linkedin_url"),
            "status": decision.get("status") or "accepted",
            "reasons": decision.get("reasons") or [],
        }

    return {
        "run_id": run_id,
        "run_label": run_display_label(load_artifact(data_dir, run_id, "batch")["seed_person"]),
        "run_color": run_color(run_id),
        "query": query,
        "people": sorted(people.values(), key=lambda item: (item["full_name"] or "").lower()),
        "person_count": len(people),
    }


def query_people_for_run(data_dir: Path, run_id: str, vector_id: str) -> dict[str, dict[str, Any]]:
    filter_decisions = load_artifact(data_dir, run_id, "filter_decisions")
    people: dict[str, dict[str, Any]] = {}
    for decision in filter_decisions:
        candidate = decision.get("candidate") or {}
        if str(candidate.get("source_vector_id")) != vector_id:
            continue
        pkey = person_key(candidate)
        people[pkey] = {
            "full_name": candidate.get("full_name") or "Unknown Person",
            "current_title": candidate.get("current_title") or "",
            "current_company": candidate.get("current_company") or "",
            "linkedin_url": candidate.get("linkedin_url"),
            "status": decision.get("status") or "accepted",
        }
    return people


def build_query_overlap_detail_payload(
    data_dir: Path,
    left_run_id: str,
    left_vector_id: str,
    right_run_id: str,
    right_vector_id: str,
) -> dict[str, Any]:
    left_queries = load_artifact(data_dir, left_run_id, "queries")
    right_queries = load_artifact(data_dir, right_run_id, "queries")
    left_query = next((item for item in left_queries if str(item.get("vector_id")) == left_vector_id), None)
    right_query = next((item for item in right_queries if str(item.get("vector_id")) == right_vector_id), None)
    if left_query is None or right_query is None:
        raise FileNotFoundError("One or both query references no longer exist in the saved run artifacts")

    left_people = query_people_for_run(data_dir, left_run_id, left_vector_id)
    right_people = query_people_for_run(data_dir, right_run_id, right_vector_id)
    shared_keys = set(left_people) & set(right_people)

    return {
        "left": {
            "run_id": left_run_id,
            "run_label": run_display_label(load_artifact(data_dir, left_run_id, "batch")["seed_person"]),
            "vector_id": left_vector_id,
            "label": query_display_label(left_query),
        },
        "right": {
            "run_id": right_run_id,
            "run_label": run_display_label(load_artifact(data_dir, right_run_id, "batch")["seed_person"]),
            "vector_id": right_vector_id,
            "label": query_display_label(right_query),
        },
        "intersection_count": len(shared_keys),
        "shared_people": [left_people[pkey] for pkey in sorted(shared_keys)],
    }


def parse_aggregate_query_id(data_dir: Path, query_id: str) -> tuple[str, str]:
    parts = query_id.split(":", 2)
    if len(parts) != 3 or parts[0] != "q":
        raise ValueError(f"Invalid aggregate query node id: {query_id}")
    run_index = int(parts[1])
    resolved_run_ids = sorted(run_ids(data_dir))
    if run_index < 0 or run_index >= len(resolved_run_ids):
        raise ValueError(f"Unknown aggregate run index: {run_index}")
    return resolved_run_ids[run_index], parts[2]


def build_query_overlap_detail_from_node_ids(
    data_dir: Path,
    left_query_id: str,
    right_query_id: str,
) -> dict[str, Any]:
    left_run_id, left_vector_id = parse_aggregate_query_id(data_dir, left_query_id)
    right_run_id, right_vector_id = parse_aggregate_query_id(data_dir, right_query_id)
    return build_query_overlap_detail_payload(
        data_dir,
        left_run_id,
        left_vector_id,
        right_run_id,
        right_vector_id,
    )


def build_overlap_payload(data_dir: Path, run_id: str | None = None) -> dict[str, Any]:
    resolved_run_id = run_id or latest_run_id(data_dir)
    queries = load_artifact(data_dir, resolved_run_id, "queries")
    filter_decisions = load_artifact(data_dir, resolved_run_id, "filter_decisions")
    batch = load_artifact(data_dir, resolved_run_id, "batch")
    run_summary = load_artifact(data_dir, resolved_run_id, "run_summary")
    current_database, database_source = load_pre_run_database(data_dir, resolved_run_id)

    query_map = {query["vector_id"]: query for query in queries}
    query_people: dict[str, dict[str, dict[str, Any]]] = {query["vector_id"]: {} for query in queries}
    person_queries: dict[str, set[str]] = defaultdict(set)

    for decision in filter_decisions:
        candidate = decision["candidate"]
        vector_id = candidate["source_vector_id"]
        pkey = person_key(candidate)
        query_people[vector_id][pkey] = {
            "key": pkey,
            "full_name": candidate.get("full_name"),
            "current_title": candidate.get("current_title"),
            "current_company": candidate.get("current_company"),
            "linkedin_url": candidate.get("linkedin_url"),
            "status": decision["status"],
        }
        person_queries[pkey].add(vector_id)

    db_people: dict[str, dict[str, Any]] = {}
    for row in current_database:
        pkey = person_key(row)
        db_people[pkey] = {
            "key": pkey,
            "full_name": row.get("full_name"),
            "current_title": row.get("current_title"),
            "current_company": row.get("current_company"),
            "linkedin_url": row.get("linkedin_url"),
        }

    query_nodes = []
    for query in queries:
        members = query_people[query["vector_id"]]
        same_company_count = sum(
            1
            for person in members.values()
            if normalize_text(person.get("current_company")) == normalize_text(batch["seed_person"]["company_name"])
        )
        query_nodes.append(
            {
                "vector_id": query["vector_id"],
                "label": query_display_label(query),
                "short_label": query_short_label(query),
                "target_bucket": query["target_bucket"],
                "template_file": query["template_file"],
                "query_text": query["query_text"],
                "result_count": len(members),
                "same_company_count": same_company_count,
                "similar_company_count": len(members) - same_company_count,
                "database_overlap_count": len(set(members) & set(db_people)),
            }
        )

    pairwise = []
    for left in queries:
        left_id = left["vector_id"]
        left_members = set(query_people[left_id])
        for right in queries:
            right_id = right["vector_id"]
            if left_id >= right_id:
                continue
            right_members = set(query_people[right_id])
            intersection = left_members & right_members
            pairwise.append(
                {
                    "left_vector_id": left_id,
                    "right_vector_id": right_id,
                    "left_label": query_display_label(left),
                    "right_label": query_display_label(right),
                    "intersection_count": len(intersection),
                    "left_only_count": len(left_members - right_members),
                    "right_only_count": len(right_members - left_members),
                    "jaccard": round(len(intersection) / len(left_members | right_members), 3)
                    if (left_members or right_members)
                    else 0.0,
                    "shared_people": [
                        query_people[left_id][pkey]
                        for pkey in sorted(intersection)
                    ][:18],
                }
            )

    database_overlaps = []
    db_keys = set(db_people)
    for query in queries:
        query_id = query["vector_id"]
        query_members = set(query_people[query_id])
        intersection = query_members & db_keys
        database_overlaps.append(
            {
                "vector_id": query_id,
                "label": query_display_label(query),
                "intersection_count": len(intersection),
                "query_only_count": len(query_members - db_keys),
                "database_only_count": len(db_keys - query_members),
                "shared_people": [db_people[pkey] for pkey in sorted(intersection)][:18],
            }
        )

    repeated_people = []
    for pkey, query_ids in person_queries.items():
        if len(query_ids) <= 1:
            continue
        exemplar_query = sorted(query_ids)[0]
        repeated_people.append(
            {
                **query_people[exemplar_query][pkey],
                "query_ids": sorted(query_ids),
                "query_count": len(query_ids),
            }
        )

    repeated_people.sort(key=lambda item: (-item["query_count"], item.get("full_name") or ""))

    return {
        "run_id": resolved_run_id,
        "seed_person": batch["seed_person"],
        "summary": run_summary,
        "database_info": {
            "source": database_source,
            "record_count": len(db_people),
            "note": (
                "Database overlap is calculated against the pre-run database snapshot."
                if database_source.endswith("_pre_run_database.json")
                else "Pre-run snapshot unavailable for this run; falling back to the current contents of data/leads.json."
            ),
        },
        "queries": query_nodes,
        "pairwise": sorted(pairwise, key=lambda item: (-item["intersection_count"], item["left_vector_id"], item["right_vector_id"])),
        "database_overlaps": sorted(database_overlaps, key=lambda item: (-item["intersection_count"], item["vector_id"])),
        "repeated_people": repeated_people[:30],
        "stats": {
            "query_count": len(queries),
            "database_record_count": len(db_people),
            "multi_query_people_count": len(repeated_people),
            "strongest_pair_overlap": max((item["intersection_count"] for item in pairwise), default=0),
        },
    }
