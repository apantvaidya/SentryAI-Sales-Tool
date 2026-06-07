from __future__ import annotations

import json
from typing import Type, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from .config import settings

T = TypeVar("T", bound=BaseModel)


class LLMError(RuntimeError):
    pass


def _strict_json_schema(model: Type[BaseModel]) -> dict:
    schema = model.model_json_schema()

    def visit(node: object) -> None:
        if isinstance(node, dict):
            if node.get("type") == "object":
                node.setdefault("additionalProperties", False)
                properties = node.get("properties")
                if isinstance(properties, dict):
                    node["required"] = list(properties.keys())
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for item in node:
                visit(item)

    visit(schema)
    return schema


def _extract_json_text(payload: dict) -> str:
    output = payload.get("output") or []
    text_chunks: list[str] = []
    for item in output:
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                text_chunks.append(content["text"])
    text = "".join(text_chunks).strip()
    if not text:
        raise LLMError(f"OpenAI returned empty text output: {payload}")
    return text


def _coerce_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:].strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise LLMError(f"Model response did not contain a JSON object: {text}")
    try:
        return json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as exc:
        raise LLMError(f"Failed to parse JSON response: {exc}\nRaw response: {text}") from exc


def call_json(prompt: str, response_model: Type[T]) -> T:
    if not settings.openai_api_key:
        raise LLMError("OPENAI_API_KEY is not set.")

    url = "https://api.openai.com/v1/responses"
    body = {
        "model": settings.openai_model,
        "input": prompt,
        "temperature": settings.openai_temperature,
        "text": {
            "format": {
                "type": "json_schema",
                "name": response_model.__name__,
                "schema": _strict_json_schema(response_model),
                "strict": True,
            }
        },
    }
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }

    with httpx.Client(timeout=settings.openai_timeout_seconds) as client:
        response = client.post(url, headers=headers, json=body)

    if response.status_code >= 400:
        raise LLMError(f"OpenAI request failed ({response.status_code}): {response.text}")

    payload = response.json()
    text = _extract_json_text(payload)
    data = _coerce_json(text)

    try:
        return response_model.model_validate(data)
    except ValidationError as exc:
        raise LLMError(
            f"OpenAI JSON did not match {response_model.__name__}: {exc}\nPayload: {data}"
        ) from exc
