from __future__ import annotations

from typing import Any
from urllib import error, request
import json

from .config import Settings
from .models import RenderedQuery


class ExaAPIError(RuntimeError):
    pass


class ExaClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def search_people(self, rendered_query: RenderedQuery) -> dict[str, Any]:
        if not self.settings.exa_api_key:
            raise ExaAPIError("EXA_API_KEY is required to run Exa searches")

        payload: dict[str, Any] = {
            "query": rendered_query.query_text,
            "category": "people",
            "type": self.settings.search_type,
            "numResults": self.settings.num_results,
        }
        if self.settings.user_location:
            payload["userLocation"] = self.settings.user_location

        encoded_payload = json.dumps(payload).encode("utf-8")
        api_request = request.Request(
            self.settings.exa_api_url,
            data=encoded_payload,
            headers={
                "Content-Type": "application/json",
                "x-api-key": self.settings.exa_api_key,
            },
            method="POST",
        )

        try:
            with request.urlopen(api_request, timeout=self.settings.timeout_seconds) as response:
                response_text = response.read().decode("utf-8")
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise ExaAPIError(
                f"Exa API returned HTTP {exc.code} for vector {rendered_query.vector_id}: {detail}"
            ) from exc
        except error.URLError as exc:
            raise ExaAPIError(f"Exa API request failed: {exc}") from exc

        parsed_response = json.loads(response_text)
        return {
            "query": rendered_query.to_dict(),
            "request_payload": payload,
            "response": parsed_response,
        }
