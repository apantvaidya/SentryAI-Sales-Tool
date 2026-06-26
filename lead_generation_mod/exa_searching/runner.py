from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any

from .config import Settings
from .dedupe import dedupe_records, is_same_company_name, normalize_text
from .exa import ExaClient
from .filters import filter_candidate
from .mapper import map_result_node
from .models import (
    ExpansionResult,
    MappedCandidate,
    PersonaLeadBatch,
    RunResult,
    SeedPersona,
)
from .pivot import lead_record_to_seed, select_pivot
from .queries import build_queries
from .store import load_leads, persist_leads, write_json, write_run_artifacts


def slugify(value: str, max_length: int = 28) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:max_length].strip("-") or "unknown"


def build_run_id(seed_persona: SeedPersona) -> str:
    timestamp = datetime.now().astimezone().strftime("%Y-%m-%d_%H%M")
    person_slug = slugify(seed_persona.person_name)
    company_slug = slugify(seed_persona.company_name)
    return f"exa_{timestamp}_{company_slug}_{person_slug}"


class LeadGenerationRunner:
    def __init__(self, settings: Settings, exa_client: ExaClient | None = None) -> None:
        self.settings = settings
        self.exa_client = exa_client or ExaClient(settings)

    @classmethod
    def create(cls, settings: Settings | None = None) -> "LeadGenerationRunner":
        resolved_settings = settings or Settings.load()
        return cls(resolved_settings)

    def run(self, seed_persona: SeedPersona) -> RunResult:
        self.settings.ensure_runtime_paths()
        run_id = build_run_id(seed_persona)

        rendered_queries = build_queries(seed_persona, self.settings.template_dir)
        raw_search_artifacts: list[dict[str, Any]] = []
        mapped_candidates: list[MappedCandidate] = []
        unmapped_results: list[dict[str, Any]] = []

        for rendered_query in rendered_queries:
            search_artifact = self.exa_client.search_people(rendered_query)
            raw_search_artifacts.append(search_artifact)

            response_results = (search_artifact.get("response") or {}).get("results") or []
            for result_node in response_results:
                candidate = map_result_node(result_node, rendered_query)
                if candidate is None:
                    unmapped_results.append(
                        {
                            "vector_id": rendered_query.vector_id,
                            "vector_name": rendered_query.vector_name,
                            "result_url": result_node.get("url"),
                            "reason": "missing_entities_or_current_role",
                        }
                    )
                    continue
                mapped_candidates.append(candidate)

        filter_decisions = [filter_candidate(candidate, seed_persona) for candidate in mapped_candidates]

        accepted_candidates = dedupe_records(
            [decision.candidate for decision in filter_decisions if decision.status == "accepted"]
        )
        dropped_decisions = [decision for decision in filter_decisions if decision.status == "dropped"]
        accepted_with_flags_count = sum(1 for decision in filter_decisions if decision.status == "accepted" and decision.reasons)

        same_company_matches = []
        similar_company_matches = []
        for candidate in accepted_candidates:
            lead_record = candidate.to_lead_record()
            if is_same_company_name(lead_record.current_company, seed_persona.company_name):
                same_company_matches.append(lead_record)
            else:
                similar_company_matches.append(lead_record)

        batch = PersonaLeadBatch(
            seed_person=seed_persona,
            same_company_matches=same_company_matches,
            similar_company_matches=similar_company_matches,
        )

        pre_run_database = load_leads(self.settings.leads_file)
        storage_summary = persist_leads(self.settings.leads_file, batch.all_records())

        artifacts = {
            "queries": [query.to_dict() for query in rendered_queries],
            "mapped_candidates": [candidate.to_dict() for candidate in mapped_candidates],
            "unmapped_candidates": unmapped_results,
            "filter_decisions": [decision.to_dict() for decision in filter_decisions],
            "pre_run_database": [record.to_dict() for record in pre_run_database],
            "batch": batch.to_dict(),
        }
        artifact_paths = write_run_artifacts(self.settings.data_dir, run_id, artifacts)

        summary = {
            "query_count": len(rendered_queries),
            "search_result_count": sum(
                len((artifact.get("response") or {}).get("results") or []) for artifact in raw_search_artifacts
            ),
            "mapped_count": len(mapped_candidates),
            "unmapped_count": len(unmapped_results),
            "accepted_count": len(accepted_candidates),
            "accepted_with_flags_count": accepted_with_flags_count,
            "dropped_count": len(dropped_decisions),
            "same_company_count": len(same_company_matches),
            "similar_company_count": len(similar_company_matches),
            "storage": storage_summary,
        }

        summary_artifact_path = write_run_artifacts(
            self.settings.data_dir,
            run_id,
            {"run_summary": summary},
        )
        artifact_paths.update(summary_artifact_path)

        return RunResult(
            run_id=run_id,
            batch=batch,
            summary=summary,
            artifact_paths=artifact_paths,
        )

    def run_expansion(
        self,
        original_seed: SeedPersona,
        target_count: int,
        max_hops: int = 20,
    ) -> ExpansionResult:
        if target_count < 1:
            raise ValueError("target_count must be at least 1")
        if max_hops < 1:
            raise ValueError("max_hops must be at least 1")

        self.settings.ensure_runtime_paths()

        seen_companies = {normalize_text(original_seed.company_name)}
        pivot_trail: list[SeedPersona] = [original_seed]
        hop_results: list[RunResult] = []
        current_seed = original_seed
        original_role = original_seed.role

        leads_collected = 0
        stopped_reason = "max_hops_reached"

        while len(hop_results) < max_hops:
            result = self.run(current_seed)
            hop_results.append(result)

            # leads.json is the deduplicated store written by persist_leads, so its
            # count automatically respects cross-hop deduplication.
            leads_collected = len(load_leads(self.settings.leads_file))

            if leads_collected >= target_count:
                stopped_reason = "target_reached"
                break

            pivot = select_pivot(
                result.batch.similar_company_matches,
                original_role,
                seen_companies,
            )
            if pivot is None:
                stopped_reason = "no_pivot_found"
                break

            try:
                next_seed = lead_record_to_seed(
                    pivot,
                    target_industry=original_seed.target_industry,
                    target_location=original_seed.target_location,
                )
            except ValueError:
                # Malformed pivot candidate (e.g. missing name/title). Stop
                # gracefully rather than sending a broken seed to Exa.
                stopped_reason = "no_pivot_found"
                break

            seen_companies.add(normalize_text(pivot.current_company))
            current_seed = next_seed
            pivot_trail.append(current_seed)

        expansion = ExpansionResult(
            original_seed=original_seed,
            target_count=target_count,
            hop_results=hop_results,
            pivot_trail=pivot_trail,
            total_leads_collected=leads_collected,
            stopped_reason=stopped_reason,
        )

        self._write_expansion_summary(expansion)
        return expansion

    def _write_expansion_summary(self, expansion: ExpansionResult) -> str:
        timestamp = datetime.now().astimezone().strftime("%Y-%m-%d_%H%M%S")
        company_slug = slugify(expansion.original_seed.company_name)
        person_slug = slugify(expansion.original_seed.person_name)
        filename = f"expansion_{timestamp}_{company_slug}_{person_slug}_summary.json"
        summary_path = self.settings.data_dir / filename
        write_json(summary_path, expansion.to_dict())
        return str(summary_path)
