from warm_outreach.pipeline import run_pipeline_for_lead
from warm_outreach.schemas import (
    EmailDraft,
    EvidenceSummary,
    Lead,
    LinkedInActivity,
    LinkedInMessageDraft,
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
        professional_interest_queries=[
            "construction leaders physical security site visibility incident review",
            "multi-site operations leaders safety asset protection monitoring",
        ],
    )
    evidence = EvidenceSummary(
        safe_claims=["Large distributed facilities often care about after-hours visibility and incident review."],
        unsafe_claims_to_avoid=["Do not claim Tesla experienced incidents."],
        best_email_angle="Reference the lead's interest in site visibility and incident review.",
        personalization_anchor="A recent LinkedIn discussion about site visibility and operational discipline.",
        geographic_confidence="medium",
        source_urls=["https://www.tesla.com/findus"],
        confidence="medium",
    )
    email = EmailDraft(
        subject="Quick idea for Tesla site visibility",
        body=(
            "Hi Diego, I came across your work as Staff Construction Manager at Tesla. "
            "Your perspective on site visibility and operational discipline really stood out to us. "
            "Given your experience in construction operations, I'd love to chat and share notes. We're building Agentic Security solutions to reduce pressure on security teams, and I'd be interested to hear how you think about site visibility and incident review. "
            "Would you be open to a quick conversation next week?"
        ),
    )
    linkedin_message = LinkedInMessageDraft(
        body=(
            "Hi Diego - noticed your work in construction operations at Tesla. "
            "Your perspective on site visibility stood out to me. "
            "I'm reaching out because we're building Agentic Security solutions to reduce pressure on security teams. "
            "Would love to compare notes sometime if you're open."
        )
    )
    linkedin_activity = [
        LinkedInActivity(
            url="https://www.linkedin.com/posts/sample",
            title="Post about site visibility",
            text="Thoughts on improving site visibility and operational discipline across active projects.",
        )
    ]
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
            "LinkedInMessageDraft": linkedin_message,
        }
        return response_model.model_validate(mapping[response_model.__name__].model_dump(mode="json"))

    monkeypatch.setattr("warm_outreach.pipeline.call_json", fake_call_json)
    monkeypatch.setattr("warm_outreach.pipeline.run_searches", lambda *args, **kwargs: search_results)
    monkeypatch.setattr("warm_outreach.pipeline.fetch_linkedin_activity_via_exa", lambda *args, **kwargs: linkedin_activity)

    result = run_pipeline_for_lead(lead)

    assert result.lead == lead
    assert result.persona == persona
    assert result.queries == queries
    assert result.search_results == search_results
    assert result.linkedin_activity == linkedin_activity
    assert result.evidence_summary == evidence
    assert result.email == email
    assert result.linkedin_message == linkedin_message
    assert result.validation.recommendation in {"approve", "human_review"}
