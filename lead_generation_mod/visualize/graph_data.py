from __future__ import annotations

from collections import defaultdict
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


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def run_ids(data_dir: Path) -> list[str]:
    results = []
    for path in data_dir.glob("*_run_summary.json"):
        name = path.name
        if name.endswith("_run_summary.json"):
            results.append(name[: -len("_run_summary.json")])
    return sorted(results, reverse=True)


def load_artifact(data_dir: Path, run_id: str, artifact_name: str) -> Any:
    path = data_dir / f"{run_id}_{artifact_name}.json"
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
    return f"Q{query['vector_id']}"


def query_display_label(query: dict[str, Any]) -> str:
    name = query.get("vector_name", "").replace("_", " ").strip()
    title = " ".join(word.capitalize() for word in name.split())
    return f"Q{query['vector_id']} {title}"


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
