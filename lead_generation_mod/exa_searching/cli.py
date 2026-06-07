from __future__ import annotations

import argparse
import json
import sys

from .config import Settings
from .exa import ExaAPIError
from .models import SeedPersona
from .runner import LeadGenerationRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="exa_searching",
        description="Run the Exa-first lookalike lead pipeline for a seed persona.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_seed_parser = subparsers.add_parser(
        "run-seed",
        help="Run the Exa pipeline for a seed persona JSON file.",
    )
    run_seed_parser.add_argument(
        "--input",
        required=True,
        help="Path to a JSON file with person_name, role, company_name, and optional linkedin_url.",
    )
    run_seed_parser.add_argument(
        "--num-results",
        type=int,
        default=None,
        help="Override the EXA_NUM_RESULTS setting for this run.",
    )
    run_seed_parser.add_argument(
        "--print-batch",
        action="store_true",
        help="Include the final batch payload in stdout.",
    )

    return parser


def handle_run_seed(args: argparse.Namespace) -> int:
    settings = Settings.load()
    if args.num_results is not None:
        settings = settings.with_overrides(num_results=args.num_results)

    seed_persona = SeedPersona.from_file(args.input)
    runner = LeadGenerationRunner.create(settings)
    result = runner.run(seed_persona)

    output = {
        "run_id": result.run_id,
        "summary": result.summary,
        "artifact_paths": result.artifact_paths,
    }
    if args.print_batch:
        output["batch"] = result.batch.to_dict()

    print(json.dumps(output, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "run-seed":
            return handle_run_seed(args)
    except (ExaAPIError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
