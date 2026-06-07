from __future__ import annotations

from pathlib import Path
from typing import Any
import json

from .dedupe import are_probable_duplicates, choose_more_complete, dedupe_records
from .models import PersonaLeadRecord


def ensure_leads_file(leads_file: Path) -> None:
    leads_file.parent.mkdir(parents=True, exist_ok=True)
    if not leads_file.exists():
        leads_file.write_text("[]\n", encoding="utf-8")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def load_leads(leads_file: Path) -> list[PersonaLeadRecord]:
    ensure_leads_file(leads_file)
    payload = json.loads(leads_file.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError(f"Expected {leads_file} to contain a JSON array")
    return [PersonaLeadRecord.from_dict(item) for item in payload]


def persist_leads(leads_file: Path, incoming_records: list[PersonaLeadRecord]) -> dict[str, int]:
    existing_records = load_leads(leads_file)
    merged_records = list(existing_records)
    added = 0
    updated = 0

    for incoming in dedupe_records(incoming_records):
        duplicate_index = next(
            (
                index
                for index, existing in enumerate(merged_records)
                if are_probable_duplicates(existing, incoming)
            ),
            None,
        )

        if duplicate_index is None:
            merged_records.append(incoming)
            added += 1
            continue

        replacement = choose_more_complete(merged_records[duplicate_index], incoming)
        if replacement != merged_records[duplicate_index]:
            merged_records[duplicate_index] = replacement
            updated += 1

    final_records = dedupe_records(merged_records)
    write_json(leads_file, [record.to_dict() for record in final_records])
    return {
        "added": added,
        "updated": updated,
        "stored_total": len(final_records),
    }


def write_run_artifacts(
    data_dir: Path,
    run_id: str,
    artifacts: dict[str, Any],
) -> dict[str, str]:
    artifact_paths: dict[str, str] = {}
    for artifact_name, payload in artifacts.items():
        artifact_path = data_dir / f"{run_id}_{artifact_name}.json"
        write_json(artifact_path, payload)
        artifact_paths[artifact_name] = str(artifact_path)
    return artifact_paths
