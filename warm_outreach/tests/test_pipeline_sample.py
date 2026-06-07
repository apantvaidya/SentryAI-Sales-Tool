from warm_outreach.pipeline import run_pipeline_for_lead
from warm_outreach.schemas import (
    EmailDraft,
    EvidenceSummary,
    Lead,
    PersonaClassification,
    ResearchQueries,
    SearchResult,
)


def test_pipeline_output_contains_all_sections(monkeypatch):
    lead = Lead(
        name="Diego Flores",
        email="sample@tesla.com",
        company="Tesla",
        location="Bay Area",
        linkedin="https://www.linkedin.com/in/sample",
        role="Staff Construction Manager",
        years_at_role="2",
    )

    persona = PersonaClassification(
        persona_type="construction",
        role_relevance="high",
        likely_site_types=["service centers"],
        likely_security_use_cases=["after-hours monitoring"],
        bad_angles_to_avoid=["retail shrink framing"],
        reasoning_summary="Relevant to physical site operations.",
        confidence="high",
    )
    queries = ResearchQueries(
        company_context_queries=[
            "Tesla service centers charging sites facilities construction operations",
            "Tesla physical locations service centers facilities operations",
        ],
        local_crime_queries=[
            "Bay Area police crime data theft burglary vehicle theft",
            "Santa Clara County crime dashboard property crime vehicle theft burglary",
        ],
        role_specific_risk_queries=[
            "construction site theft trespassing equipment theft after hours security",
            "auto service center lot security vehicle break-ins after hours monitoring",
        ],
    )
    evidence = EvidenceSummary(
        safe_claims=["Large distributed facilities often care about after-hours visibility and incident review."],
        unsafe_claims_to_avoid=["Do not claim Tesla experienced incidents."],
        best_email_angle="Tie SmartSentryAI to site visibility and response workflows.",
        geographic_confidence="medium",
        source_urls=["https://www.tesla.com/findus"],
        confidence="medium",
    )
    email = EmailDraft(
        subject="Quick idea for Tesla site visibility",
        body=(
            "Hi Diego, I saw you're Staff Construction Manager at Tesla. "
            "Teams overseeing active sites and facilities often want clearer after-hours visibility and faster incident review. "
            "SmartSentryAI helps physical site teams use existing cameras to improve visibility, review, and response workflows. "
            "Open to a quick compare on whether that is relevant for your environment?"
        ),
    )
    search_results = [
        SearchResult(
            query=queries.company_context_queries[0],
            title="Tesla Locations",
            url="https://www.tesla.com/findus",
            snippet="Find Tesla stores, service centers and Superchargers.",
            raw_content=None,
            source_type="official_company",
            confidence="medium",
        )
    ]

    def fake_call_json(prompt, response_model):
        mapping = {
            "PersonaClassification": persona,
            "ResearchQueries": queries,
            "EvidenceSummary": evidence,
            "EmailDraft": email,
        }
        return response_model.model_validate(mapping[response_model.__name__].model_dump(mode="json"))

    monkeypatch.setattr("warm_outreach.pipeline.call_json", fake_call_json)
    monkeypatch.setattr("warm_outreach.pipeline.run_searches", lambda *args, **kwargs: search_results)

    result = run_pipeline_for_lead(lead)

    assert result.lead == lead
    assert result.persona == persona
    assert result.queries == queries
    assert result.search_results == search_results
    assert result.evidence_summary == evidence
    assert result.email == email
    assert result.validation.recommendation in {"approve", "human_review"}
