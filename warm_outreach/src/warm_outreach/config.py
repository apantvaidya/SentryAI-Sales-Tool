from __future__ import annotations

import os
from dataclasses import dataclass

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    def load_dotenv(*_args, **_kwargs) -> bool:
        return False


load_dotenv()


@dataclass(frozen=True)
class Settings:
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    tavily_api_key: str | None = os.getenv("TAVILY_API_KEY")
    exa_api_key: str | None = os.getenv("EXA_API_KEY")
    exa_api_url: str = os.getenv("EXA_API_URL", "https://api.exa.ai/search")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    openai_temperature: float = float(os.getenv("OPENAI_TEMPERATURE", "0.2"))
    tavily_max_results: int = int(os.getenv("TAVILY_MAX_RESULTS", "5"))
    tavily_search_depth: str = os.getenv("TAVILY_SEARCH_DEPTH", "basic")
    openai_timeout_seconds: float = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "45"))
    tavily_timeout_seconds: float = float(os.getenv("TAVILY_TIMEOUT_SECONDS", "30"))
    exa_timeout_seconds: float = float(os.getenv("EXA_TIMEOUT_SECONDS", "20"))


settings = Settings()
