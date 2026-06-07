from warm_outreach.pipeline import classify_lead
from warm_outreach.schemas import Lead, PersonaClassification


def test_staff_construction_manager_maps_to_construction(monkeypatch):
    lead = Lead(
        name="Diego Flores",
        email="sample@tesla.com",
        company="Tesla",
        location="Bay Area",
        linkedin="https://www.linkedin.com/in/sample",
        role="Staff Construction Manager",
        years_at_role="2",
    )

    def fake_call_json(prompt, response_model):
        assert "Tesla Staff Construction Manager" in prompt
        assert "construction / physical site operations" in prompt
        return response_model.model_validate(
            PersonaClassification(
                persona_type="construction",
                role_relevance="high",
                likely_site_types=["service centers", "charging sites"],
                likely_security_use_cases=["after-hours monitoring", "incident review"],
                bad_angles_to_avoid=["retail shrink framing"],
                reasoning_summary="Construction leadership over physical sites is relevant.",
                confidence="high",
            ).model_dump(mode="json")
        )

    monkeypatch.setattr("warm_outreach.pipeline.call_json", fake_call_json)

    result = classify_lead(lead)
    assert result.persona_type == "construction"
    assert result.persona_type != "loss_prevention"
