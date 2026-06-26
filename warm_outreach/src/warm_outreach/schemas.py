from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Lead(BaseModel):
    name: str
    email: str | None = None
    company: str
    location: str | None = None
    linkedin: str | None = None
    role: str
    years_at_role: str | None = None
    current_role_description: str | None = None


class PersonaClassification(BaseModel):
    persona_type: Literal[
        "asset_protection",
        "loss_prevention",
        "physical_security",
        "facilities",
        "construction",
        "operations",
        "safety_ehs",
        "low_relevance",
    ]
    role_relevance: Literal["high", "medium", "low"]
    likely_site_types: list[str] = Field(default_factory=list)
    likely_security_use_cases: list[str] = Field(default_factory=list)
    bad_angles_to_avoid: list[str] = Field(default_factory=list)
    reasoning_summary: str
    confidence: Literal["high", "medium", "low"]


class ResearchQueries(BaseModel):
    company_context_queries: list[str] = Field(default_factory=list)
    professional_interest_queries: list[str] = Field(default_factory=list)


class SearchResult(BaseModel):
    query: str
    title: str
    url: str
    snippet: str | None = None
    raw_content: str | None = None
    source_type: Literal[
        "official_government",
        "official_company",
        "reputable_news",
        "industry_source",
        "general_web",
        "unknown",
    ]
    confidence: Literal["high", "medium", "low"]


class LinkedInActivity(BaseModel):
    url: str | None = None
    title: str | None = None
    text: str


class EvidenceSummary(BaseModel):
    safe_claims: list[str] = Field(default_factory=list)
    unsafe_claims_to_avoid: list[str] = Field(default_factory=list)
    best_email_angle: str
    personalization_anchor: str | None = None
    geographic_confidence: Literal["high", "medium", "low"]
    source_urls: list[str] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"]


class EmailDraft(BaseModel):
    subject: str
    body: str


class LinkedInMessageDraft(BaseModel):
    body: str


class ValidationResult(BaseModel):
    passes_word_count: bool
    forbidden_phrases_found: list[str] = Field(default_factory=list)
    has_source_urls: bool
    needs_review: bool
    recommendation: Literal["approve", "human_review", "reject"]
    notes: list[str] = Field(default_factory=list)


class PipelineOutput(BaseModel):
    lead: Lead
    persona: PersonaClassification
    queries: ResearchQueries
    search_results: list[SearchResult] = Field(default_factory=list)
    linkedin_activity: list[LinkedInActivity] = Field(default_factory=list)
    evidence_summary: EvidenceSummary
    email: EmailDraft
    linkedin_message: LinkedInMessageDraft
    validation: ValidationResult
