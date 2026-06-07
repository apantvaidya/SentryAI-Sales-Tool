from __future__ import annotations

from .schemas import EmailDraft, EvidenceSummary, ValidationResult

FORBIDDEN_PHRASES = [
    "we know your area has crime",
    "your locations are unsafe",
    "your stores have crime",
    "dangerous area",
    "high crime area",
    "your company is dealing with",
    "your locations are experiencing",
    "your stores are seeing",
]


def validate_email(email: EmailDraft, evidence: EvidenceSummary) -> ValidationResult:
    notes: list[str] = []
    body_lower = email.body.lower()
    word_count = len(email.body.split())
    passes_word_count = word_count < 120
    forbidden_phrases_found = [phrase for phrase in FORBIDDEN_PHRASES if phrase in body_lower]
    has_source_urls = bool(evidence.source_urls)
    needs_review = False

    if not passes_word_count:
        notes.append(f"Email body exceeds 119 words ({word_count}).")
        needs_review = True

    if evidence.confidence == "low":
        notes.append("Evidence confidence is low.")
        needs_review = True

    if not has_source_urls and evidence.confidence != "low":
        notes.append("Evidence summary is missing source URLs despite non-low confidence.")
        needs_review = True

    if forbidden_phrases_found:
        notes.append("Forbidden or unsupported phrasing found in email body.")
        return ValidationResult(
            passes_word_count=passes_word_count,
            forbidden_phrases_found=forbidden_phrases_found,
            has_source_urls=has_source_urls,
            needs_review=True,
            recommendation="reject",
            notes=notes,
        )

    recommendation = "approve"
    if needs_review:
        recommendation = "human_review"

    return ValidationResult(
        passes_word_count=passes_word_count,
        forbidden_phrases_found=forbidden_phrases_found,
        has_source_urls=has_source_urls,
        needs_review=needs_review,
        recommendation=recommendation,
        notes=notes,
    )
