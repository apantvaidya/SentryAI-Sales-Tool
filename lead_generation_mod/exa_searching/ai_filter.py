from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any
from urllib import error, request
import json

from .config import Settings
from .models import MappedCandidate, SeedPersona


class AIFilterError(RuntimeError):
    pass


@dataclass(frozen=True)
class AIFilterDecision:
    status: str
    reason_codes: list[str]
    explanation: str | None = None
    confidence: str | None = None

    def __post_init__(self) -> None:
        if self.status not in {"accepted", "dropped"}:
            raise ValueError(f"Unsupported AI filter status: {self.status}")
        if self.confidence is not None and self.confidence not in {"high", "medium", "low"}:
            raise ValueError(f"Unsupported AI filter confidence: {self.confidence}")

    def to_metadata(self) -> dict[str, Any]:
        if not self.reason_codes and not self.explanation and not self.confidence:
            return {}

        payload = {"ai_status": self.status}
        if self.reason_codes:
            payload["ai_reason_codes"] = list(self.reason_codes)
        if self.explanation:
            payload["ai_explanation"] = self.explanation
        if self.confidence:
            payload["ai_confidence"] = self.confidence
        return payload


def ai_filter_is_enabled(settings: Settings) -> bool:
    return settings.ai_filter_enabled and bool(settings.openai_api_key)


def _trim(value: str | None, max_length: int = 280) -> str | None:
    if not value:
        return None
    text = value.strip()
    if len(text) <= max_length:
        return text
    return f"{text[: max_length - 3].rstrip()}..."


def _candidate_payload(candidate: MappedCandidate, index: int) -> dict[str, Any]:
    return {
        "index": index,
        "full_name": candidate.full_name,
        "current_title": candidate.current_title,
        "current_company": candidate.current_company,
        "resolved_location": candidate.resolved_location,
        "years_at_current_role": candidate.years_at_current_role,
        "current_role_description": _trim(candidate.current_role_description, 320),
        "source_vector_name": candidate.source_vector_name,
        "source_query_text": _trim(candidate.source_query_text, 360),
        "source_bucket": candidate.source_bucket,
        "mapping_notes": list(candidate.mapping_notes),
    }


def _prompt(seed_persona: SeedPersona, candidates: list[MappedCandidate]) -> str:
    payload = {
        "seed_persona": asdict(seed_persona),
        "candidates": [_candidate_payload(candidate, index) for index, candidate in enumerate(candidates)],
    }
    return (
        "You are filtering lead-generation candidates for SmartSentryAI.\n\n"
        "Your job is to decide whether each candidate is the right type of lead for the exact search intent that produced it.\n"
        "Be strict about company and role fit, but do not drop a candidate for a minor wording difference alone.\n\n"
        "Rules:\n"
        "- Use the seed company, seed role, target industry, and target location as the primary context.\n"
        "- `same_company` candidates should only be accepted when the company is clearly the seed company, the same brand, or an obvious authorized-retailer / branded variation.\n"
        "- `similar_company` candidates should only be accepted when the company is plausibly in the seed's target industry or business archetype.\n"
        "- `exact_or_near_role` vectors should be stricter on title fit than adjacent-role vectors.\n"
        "- A security-sounding title alone is not enough if the company is the wrong type of business.\n"
        "- Shared names, generic titles, and vague leadership roles are not enough to accept a lead.\n"
        "- Treat target_location as a preference, not an automatic reject, unless the mismatch is clearly disqualifying.\n"
        "- Prefer dropping obvious false positives over keeping them.\n\n"
        "Return only valid JSON with this shape:\n"
        '{\n'
        '  "decisions": [\n'
        '    {\n'
        '      "index": 0,\n'
        '      "status": "accepted" | "dropped",\n'
        '      "reason_codes": ["short_machine_readable_reason"],\n'
        '      "confidence": "high" | "medium" | "low",\n'
        '      "explanation": "one short sentence"\n'
        '    }\n'
        "  ]\n"
        "}\n\n"
        f"Input:\n{json.dumps(payload, indent=2)}"
    )


def _parse_response(text: str, expected_count: int) -> list[AIFilterDecision]:
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AIFilterError(f"Failed to parse AI filter JSON: {exc}\nRaw: {text}") from exc

    decisions = payload.get("decisions")
    if not isinstance(decisions, list):
        raise AIFilterError(f"AI filter response missing decisions array: {payload}")

    parsed_by_index: dict[int, AIFilterDecision] = {}
    for item in decisions:
        if not isinstance(item, dict):
            raise AIFilterError(f"AI filter decision must be an object: {item}")
        index = item.get("index")
        if not isinstance(index, int):
            raise AIFilterError(f"AI filter decision missing integer index: {item}")
        status = str(item.get("status") or "").strip()
        reason_codes = item.get("reason_codes") or []
        if not isinstance(reason_codes, list):
            raise AIFilterError(f"AI filter reason_codes must be a list: {item}")
        confidence_value = item.get("confidence")
        explanation_value = item.get("explanation")
        parsed_by_index[index] = AIFilterDecision(
            status=status,
            reason_codes=[str(code).strip() for code in reason_codes if str(code).strip()],
            confidence=str(confidence_value).strip() if isinstance(confidence_value, str) and confidence_value.strip() else None,
            explanation=str(explanation_value).strip() if isinstance(explanation_value, str) and explanation_value.strip() else None,
        )

    if len(parsed_by_index) != expected_count:
        raise AIFilterError(
            f"AI filter returned {len(parsed_by_index)} decisions for {expected_count} candidates"
        )

    missing = [index for index in range(expected_count) if index not in parsed_by_index]
    if missing:
        raise AIFilterError(f"AI filter omitted candidate indices: {missing}")

    return [parsed_by_index[index] for index in range(expected_count)]


def _request_decisions(settings: Settings, prompt: str) -> str:
    body = {
        "model": settings.ai_filter_model,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": "Return only valid JSON. Be conservative and factual when filtering candidates.",
            },
            {"role": "user", "content": prompt},
        ],
    }
    api_request = request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings.openai_api_key}",
        },
        method="POST",
    )
    try:
        with request.urlopen(api_request, timeout=settings.ai_filter_timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise AIFilterError(f"OpenAI returned HTTP {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise AIFilterError(f"OpenAI request failed: {exc}") from exc

    choices = payload.get("choices") or []
    message = choices[0].get("message") if choices else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise AIFilterError(f"OpenAI response did not contain message content: {payload}")
    return content


def evaluate_candidates(
    settings: Settings,
    seed_persona: SeedPersona,
    candidates: list[MappedCandidate],
) -> list[AIFilterDecision]:
    if not candidates:
        return []
    if not ai_filter_is_enabled(settings):
        return [AIFilterDecision(status="accepted", reason_codes=[]) for _ in candidates]

    all_decisions: list[AIFilterDecision] = []
    batch_size = max(settings.ai_filter_batch_size, 1)
    for start in range(0, len(candidates), batch_size):
        chunk = candidates[start : start + batch_size]
        prompt = _prompt(seed_persona, chunk)
        content = _request_decisions(settings, prompt)
        all_decisions.extend(_parse_response(content, len(chunk)))
    return all_decisions
