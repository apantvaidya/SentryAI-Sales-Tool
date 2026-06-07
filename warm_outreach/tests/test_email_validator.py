from warm_outreach.schemas import EmailDraft, EvidenceSummary
from warm_outreach.validators import validate_email


def make_evidence(*, confidence="medium", source_urls=None):
    return EvidenceSummary(
        safe_claims=["Regional public safety reporting shows property crime is a recurring ops topic."],
        unsafe_claims_to_avoid=["Do not claim the company had incidents."],
        best_email_angle="Site visibility and incident review.",
        geographic_confidence="medium",
        source_urls=["https://example.gov/crime-dashboard"] if source_urls is None else source_urls,
        confidence=confidence,
    )


def test_forbidden_phrases_are_rejected():
    email = EmailDraft(
        subject="Quick thought",
        body="Hi Alex, we know your area has crime and your locations are unsafe.",
    )
    result = validate_email(email, make_evidence())
    assert result.recommendation == "reject"
    assert "we know your area has crime" in result.forbidden_phrases_found


def test_word_count_over_limit_triggers_review():
    email = EmailDraft(subject="Long", body="word " * 121)
    result = validate_email(email, make_evidence())
    assert result.passes_word_count is False
    assert result.recommendation == "human_review"


def test_low_evidence_confidence_produces_human_review():
    email = EmailDraft(subject="Hello", body="Hi Alex, reaching out with a relevant idea for site visibility.")
    result = validate_email(email, make_evidence(confidence="low", source_urls=[]))
    assert result.recommendation == "human_review"


def test_missing_sources_with_non_low_confidence_produces_human_review():
    email = EmailDraft(subject="Hello", body="Hi Alex, reaching out with a relevant idea for site visibility.")
    result = validate_email(email, make_evidence(confidence="medium", source_urls=[]))
    assert result.recommendation == "human_review"
