from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
import os


def env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def load_dotenv(dotenv_path: Path) -> None:
    if not dotenv_path.exists():
        # Fall back to env vars already present in the process (e.g. forwarded
        # from Next.js via service.ts's { ...process.env }).
        return

    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if not key:
            continue

        if value and len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]

        os.environ.setdefault(key, value)


@dataclass(frozen=True)
class Settings:
    project_root: Path
    template_dir: Path
    data_dir: Path
    leads_file: Path
    exa_api_key: str | None
    exa_api_url: str
    search_type: str
    num_results: int
    timeout_seconds: float
    user_location: str | None
    openai_api_key: str | None
    ai_filter_model: str
    ai_filter_enabled: bool
    ai_filter_timeout_seconds: float
    ai_filter_batch_size: int

    @classmethod
    def load(cls, project_root: Path | None = None) -> "Settings":
        root = project_root or Path(__file__).resolve().parent.parent
        load_dotenv(root / ".env")
        data_dir = root / "data"
        return cls(
            project_root=root,
            template_dir=root / "exa_payload_templates",
            data_dir=data_dir,
            leads_file=data_dir / "leads.json",
            exa_api_key=os.getenv("EXA_API_KEY"),
            exa_api_url=os.getenv("EXA_API_URL", "https://api.exa.ai/search"),
            search_type=os.getenv("EXA_SEARCH_TYPE", "auto"),
            num_results=int(os.getenv("EXA_NUM_RESULTS", "20")),
            timeout_seconds=float(os.getenv("EXA_TIMEOUT_SECONDS", "30")),
            user_location=os.getenv("EXA_USER_LOCATION"),
            openai_api_key=os.getenv("OPENAI_API_KEY"),
            ai_filter_model=os.getenv("LEADGEN_AI_FILTER_MODEL", os.getenv("OPENAI_MODEL", "gpt-4o-mini")),
            ai_filter_enabled=env_flag("LEADGEN_AI_FILTER_ENABLED", True),
            ai_filter_timeout_seconds=float(os.getenv("LEADGEN_AI_FILTER_TIMEOUT_SECONDS", "45")),
            ai_filter_batch_size=max(int(os.getenv("LEADGEN_AI_FILTER_BATCH_SIZE", "20")), 1),
        )

    def with_overrides(
        self,
        *,
        num_results: int | None = None,
        timeout_seconds: float | None = None,
    ) -> "Settings":
        updated = self
        if num_results is not None:
            updated = replace(updated, num_results=num_results)
        if timeout_seconds is not None:
            updated = replace(updated, timeout_seconds=timeout_seconds)
        return updated

    def ensure_runtime_paths(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
