from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
import json


def clean_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def clean_url(value: Any) -> str | None:
    text = clean_string(value)
    if text is None:
        return None
    candidate = text if "://" in text else f"https://{text.lstrip('/')}"
    parsed = urlparse(candidate)
    if not parsed.netloc:
        raise ValueError(f"Invalid URL: {text}")
    return candidate


@dataclass(frozen=True)
class SeedPersona:
    person_name: str
    role: str
    company_name: str
    linkedin_url: str | None = None

    def __post_init__(self) -> None:
        person_name = clean_string(self.person_name)
        role = clean_string(self.role)
        company_name = clean_string(self.company_name)
        linkedin_url = clean_url(self.linkedin_url)

        if not person_name:
            raise ValueError("seed_person.person_name is required")
        if not role:
            raise ValueError("seed_person.role is required")
        if not company_name:
            raise ValueError("seed_person.company_name is required")

        object.__setattr__(self, "person_name", person_name)
        object.__setattr__(self, "role", role)
        object.__setattr__(self, "company_name", company_name)
        object.__setattr__(self, "linkedin_url", linkedin_url)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "SeedPersona":
        return cls(
            person_name=payload.get("person_name"),
            role=payload.get("role"),
            company_name=payload.get("company_name"),
            linkedin_url=payload.get("linkedin_url"),
        )

    @classmethod
    def from_file(cls, path: str | Path) -> "SeedPersona":
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Seed persona file must contain a JSON object")
        return cls.from_dict(payload)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class RenderedQuery:
    vector_id: str
    vector_name: str
    template_file: str
    target_bucket: str
    query_text: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class PersonaLeadRecord:
    full_name: str | None
    current_title: str | None
    current_company: str | None
    years_at_current_role: float | None
    resolved_location: str | None
    linkedin_url: str | None
    public_business_email: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "full_name", clean_string(self.full_name))
        object.__setattr__(self, "current_title", clean_string(self.current_title))
        object.__setattr__(self, "current_company", clean_string(self.current_company))
        object.__setattr__(self, "resolved_location", clean_string(self.resolved_location))
        object.__setattr__(self, "linkedin_url", clean_string(self.linkedin_url))
        object.__setattr__(
            self,
            "public_business_email",
            clean_string(self.public_business_email),
        )

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PersonaLeadRecord":
        return cls(
            full_name=payload.get("full_name"),
            current_title=payload.get("current_title"),
            current_company=payload.get("current_company"),
            years_at_current_role=payload.get("years_at_current_role"),
            resolved_location=payload.get("resolved_location"),
            linkedin_url=payload.get("linkedin_url"),
            public_business_email=payload.get("public_business_email"),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class MappedCandidate:
    full_name: str | None
    current_title: str | None
    current_company: str | None
    years_at_current_role: float | None
    resolved_location: str | None
    linkedin_url: str | None
    public_business_email: str | None = None
    source_vector_id: str = ""
    source_vector_name: str = ""
    source_bucket: str = ""
    exa_result_id: str | None = None
    exa_result_url: str | None = None
    exa_entity_id: str | None = None
    current_role_count: int = 0
    used_recent_role_fallback: bool = False
    work_history_count: int = 0
    mapping_notes: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.full_name = clean_string(self.full_name)
        self.current_title = clean_string(self.current_title)
        self.current_company = clean_string(self.current_company)
        self.resolved_location = clean_string(self.resolved_location)
        self.linkedin_url = clean_string(self.linkedin_url)
        self.public_business_email = clean_string(self.public_business_email)
        self.exa_result_id = clean_string(self.exa_result_id)
        self.exa_result_url = clean_string(self.exa_result_url)
        self.exa_entity_id = clean_string(self.exa_entity_id)
        self.source_vector_id = clean_string(self.source_vector_id) or ""
        self.source_vector_name = clean_string(self.source_vector_name) or ""
        self.source_bucket = clean_string(self.source_bucket) or ""
        self.mapping_notes = [note for note in self.mapping_notes if clean_string(note)]

    def to_lead_record(self) -> PersonaLeadRecord:
        return PersonaLeadRecord(
            full_name=self.full_name,
            current_title=self.current_title,
            current_company=self.current_company,
            years_at_current_role=self.years_at_current_role,
            resolved_location=self.resolved_location,
            linkedin_url=self.linkedin_url,
            public_business_email=None,
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class FilterDecision:
    status: str
    reasons: list[str]
    candidate: MappedCandidate

    def __post_init__(self) -> None:
        if self.status not in {"accepted", "dropped"}:
            raise ValueError(f"Unsupported filter status: {self.status}")

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "reasons": list(self.reasons),
            "candidate": self.candidate.to_dict(),
        }


@dataclass(frozen=True)
class PersonaLeadBatch:
    seed_person: SeedPersona
    same_company_matches: list[PersonaLeadRecord]
    similar_company_matches: list[PersonaLeadRecord]

    def all_records(self) -> list[PersonaLeadRecord]:
        return [*self.same_company_matches, *self.similar_company_matches]

    def to_dict(self) -> dict[str, Any]:
        return {
            "seed_person": self.seed_person.to_dict(),
            "same_company_matches": [record.to_dict() for record in self.same_company_matches],
            "similar_company_matches": [record.to_dict() for record in self.similar_company_matches],
        }


@dataclass(frozen=True)
class RunResult:
    run_id: str
    batch: PersonaLeadBatch
    summary: dict[str, Any]
    artifact_paths: dict[str, str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "summary": self.summary,
            "artifact_paths": self.artifact_paths,
            "batch": self.batch.to_dict(),
        }
