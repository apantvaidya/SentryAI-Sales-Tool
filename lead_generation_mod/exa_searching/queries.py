from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .models import RenderedQuery, SeedPersona


@dataclass(frozen=True)
class QueryTemplateSpec:
    vector_id: str
    vector_name: str
    template_file: str
    target_bucket: str
    requires_linkedin: bool = False


QUERY_TEMPLATE_SPECS: tuple[QueryTemplateSpec, ...] = (
    QueryTemplateSpec(
        vector_id="01",
        vector_name="same_company_exact_or_near_role",
        template_file="01_same_company_exact_or_near_role.txt",
        target_bucket="same_company",
    ),
    QueryTemplateSpec(
        vector_id="02",
        vector_name="same_company_adjacent_leadership",
        template_file="02_same_company_adjacent_leadership.txt",
        target_bucket="same_company",
    ),
    QueryTemplateSpec(
        vector_id="03",
        vector_name="same_company_person_anchored_similarity",
        template_file="03_same_company_person_anchored_similarity.txt",
        target_bucket="same_company",
    ),
    QueryTemplateSpec(
        vector_id="04",
        vector_name="similar_company_exact_or_near_role",
        template_file="04_similar_company_exact_or_near_role.txt",
        target_bucket="similar_company",
    ),
    QueryTemplateSpec(
        vector_id="05",
        vector_name="similar_company_adjacent_role_family",
        template_file="05_similar_company_adjacent_role_family.txt",
        target_bucket="similar_company",
    ),
    QueryTemplateSpec(
        vector_id="06",
        vector_name="linkedin_anchored_similarity",
        template_file="06_linkedin_anchored_similarity.txt",
        target_bucket="similar_company",
        requires_linkedin=True,
    ),
    QueryTemplateSpec(
        vector_id="07",
        vector_name="linkedin_anchored_similarity_with_company_expansion",
        template_file="07_linkedin_anchored_similarity_with_company_expansion.txt",
        target_bucket="similar_company",
        requires_linkedin=True,
    ),
)


def load_template(template_dir: Path, template_file: str) -> str:
    path = template_dir / template_file
    if not path.exists():
        raise FileNotFoundError(f"Missing query template: {path}")
    return path.read_text(encoding="utf-8").strip()


def render_query_text(template: str, seed_persona: SeedPersona) -> str:
    return (
        template.replace("{{company_name}}", seed_persona.company_name)
        .replace("{{role}}", seed_persona.role)
        .replace("{{person_name}}", seed_persona.person_name)
        .replace("{{linkedin_url}}", seed_persona.linkedin_url or "")
        .strip()
    )


def build_queries(seed_persona: SeedPersona, template_dir: Path) -> list[RenderedQuery]:
    rendered_queries: list[RenderedQuery] = []

    for spec in QUERY_TEMPLATE_SPECS:
        if spec.requires_linkedin and not seed_persona.linkedin_url:
            continue

        template = load_template(template_dir, spec.template_file)
        rendered_queries.append(
            RenderedQuery(
                vector_id=spec.vector_id,
                vector_name=spec.vector_name,
                template_file=spec.template_file,
                target_bucket=spec.target_bucket,
                query_text=render_query_text(template, seed_persona),
            )
        )

    return rendered_queries
