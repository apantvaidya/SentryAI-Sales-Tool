"""LLM provider abstraction and concrete adapters.

The pipeline talks to the LLM exclusively via the `LLMProvider` Protocol so
adapters (LiteLLM, Fake, future direct SDKs) can be swapped without touching
agent code. The default production adapter is `LiteLLMProvider`, configured
per `docs/DESIGN.md §12`: primary `openai/gpt-4o-mini`, fallback chain via
LiteLLM's `fallbacks=` parameter.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class LLMProvider(Protocol):
    """Async LLM call returning a Pydantic-validated structured response."""

    async def complete_json(
        self,
        *,
        system: str,
        user: str,
        schema: type[T],
        model: str | None = None,
    ) -> T: ...


# ---------------------------------------------------------------------------
# Strict JSON-Schema helper (OpenAI structured-output compatibility).
# ---------------------------------------------------------------------------


def strict_json_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Return a JSON Schema for `model` shaped for OpenAI's strict mode.

    OpenAI's `response_format={"type": "json_schema", "strict": true, ...}`
    requires every object node to declare every property as required and to
    set `additionalProperties: false`. Pydantic's default
    `model_json_schema()` does not enforce that, so we walk the schema and
    promote every object node in place.
    """
    schema = model.model_json_schema()
    _walk_strict(schema)
    return schema


def _walk_strict(node: Any) -> None:
    if isinstance(node, dict):
        if node.get("type") == "object":
            props = node.get("properties")
            if isinstance(props, dict) and props:
                node["required"] = list(props.keys())
            node["additionalProperties"] = False
        for value in node.values():
            _walk_strict(value)
    elif isinstance(node, list):
        for item in node:
            _walk_strict(item)


# ---------------------------------------------------------------------------
# LiteLLM adapter.
# ---------------------------------------------------------------------------


class LiteLLMProvider:
    """Production adapter that routes through `litellm.acompletion`."""

    def __init__(
        self,
        *,
        primary_model: str = "openai/gpt-4o-mini",
        fallback_models: Sequence[str] = ("anthropic/claude-3-5-haiku",),
        timeout_s: float = 30.0,
    ) -> None:
        self._primary_model = primary_model
        self._fallback_models = list(fallback_models)
        self._timeout_s = timeout_s

    async def complete_json(
        self,
        *,
        system: str,
        user: str,
        schema: type[T],
        model: str | None = None,
    ) -> T:
        # Imported lazily so tests that only use FakeLLM never pay the cost.
        from litellm import acompletion

        json_schema = strict_json_schema(schema)
        response = await acompletion(
            model=model or self._primary_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": schema.__name__,
                    "schema": json_schema,
                    "strict": True,
                },
            },
            fallbacks=self._fallback_models,
            timeout=self._timeout_s,
        )
        content = response.choices[0].message.content
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("LLM returned empty content")
        return schema.model_validate_json(content)


# ---------------------------------------------------------------------------
# Test fake.
# ---------------------------------------------------------------------------


@dataclass
class FakeLLMCall:
    system: str
    user: str
    schema: str
    model: str | None


class FakeLLM:
    """Returns a pre-canned Pydantic response and records every invocation.

    Construct with the exact `BaseModel` instance you want returned; the
    schema passed at call time must match the response's class.
    """

    def __init__(self, response: BaseModel) -> None:
        self._response = response
        self.calls: list[FakeLLMCall] = []

    async def complete_json(
        self,
        *,
        system: str,
        user: str,
        schema: type[T],
        model: str | None = None,
    ) -> T:
        self.calls.append(
            FakeLLMCall(system=system, user=user, schema=schema.__name__, model=model)
        )
        if not isinstance(self._response, schema):
            raise TypeError(
                f"FakeLLM was constructed with {type(self._response).__name__} "
                f"but the caller asked for {schema.__name__}"
            )
        return self._response


__all__ = [
    "FakeLLM",
    "FakeLLMCall",
    "LLMProvider",
    "LiteLLMProvider",
    "strict_json_schema",
]
