from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json
import re

from .models import RenderedQuery, SeedPersona


@dataclass(frozen=True)
class QueryTemplateSpec:
    vector_id: str
    vector_name: str
    template_file: str
    target_bucket: str
    requires_linkedin: bool = False


QUERY_FILE_PATTERN = re.compile(r"^(?P<id>[^_]+)_(?P<name>.+)\.txt$")
DEFAULT_QUERY_SUFFIX = "Northern California"


def load_query_suffix(template_dir: Path) -> str:
    config_path = template_dir.parent / "data" / "query_targeting.json"
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
        value = str(data.get("querySuffix") or "").strip()
        return value or DEFAULT_QUERY_SUFFIX
    except Exception:
        return DEFAULT_QUERY_SUFFIX


def discover_query_templates(template_dir: Path) -> list[QueryTemplateSpec]:
    specs: list[QueryTemplateSpec] = []
    seen_ids: set[str] = set()

    for path in sorted(template_dir.glob("*.txt")):
        match = QUERY_FILE_PATTERN.match(path.name)
        if not match:
            raise ValueError(
                f"Query template filenames must use '<id>_<name>.txt': {path.name}"
            )

        vector_id = match.group("id")
        vector_name = match.group("name")
        if vector_id in seen_ids:
            raise ValueError(f"Duplicate query template id '{vector_id}' in {template_dir}")

        template = load_template(template_dir, path.name)
        target_bucket = "same_company" if vector_name.startswith("same_company") else "similar_company"
        specs.append(
            QueryTemplateSpec(
                vector_id=vector_id,
                vector_name=vector_name,
                template_file=path.name,
                target_bucket=target_bucket,
                requires_linkedin="{{linkedin_url}}" in template,
            )
        )
        seen_ids.add(vector_id)

    if not specs:
        raise FileNotFoundError(f"No query templates found in {template_dir}")

    return specs


def load_template(template_dir: Path, template_file: str) -> str:
    path = template_dir / template_file
    if not path.exists():
        raise FileNotFoundError(f"Missing query template: {path}")
    return path.read_text(encoding="utf-8").strip()


def render_query_text(template: str, seed_persona: SeedPersona, query_suffix: str) -> str:
    base = (
        template.replace("{{company_name}}", seed_persona.company_name)
        .replace("{{role}}", seed_persona.role or "")
        .replace("{{person_name}}", seed_persona.person_name)
        .replace("{{linkedin_url}}", seed_persona.linkedin_url or "")
        .strip()
    )
    return f"{base} {query_suffix}".strip()


def build_queries(seed_persona: SeedPersona, template_dir: Path) -> list[RenderedQuery]:
    rendered_queries: list[RenderedQuery] = []
    query_suffix = load_query_suffix(template_dir)

    for spec in discover_query_templates(template_dir):
        if spec.requires_linkedin and not seed_persona.linkedin_url:
            continue

        template = load_template(template_dir, spec.template_file)
        rendered_queries.append(
            RenderedQuery(
                vector_id=spec.vector_id,
                vector_name=spec.vector_name,
                template_file=spec.template_file,
                target_bucket=spec.target_bucket,
                query_text=render_query_text(template, seed_persona, query_suffix),
            )
        )

    return rendered_queries
