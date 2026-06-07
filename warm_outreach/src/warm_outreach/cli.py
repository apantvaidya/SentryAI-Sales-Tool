from __future__ import annotations

import argparse
import json

from .pipeline import (
    prepare_queries_for_csv,
    prepare_queries_for_lead,
    run_pipeline_for_csv,
    run_pipeline_for_lead,
)
from .schemas import Lead


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Warm outreach research pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_one = subparsers.add_parser("run-one", help="Run one lead from JSON")
    run_one.add_argument("--lead-json", required=True, help="JSON-encoded lead payload")
    run_one.add_argument("--max-results", type=int, default=5)
    run_one.add_argument("--include-raw-content", action="store_true")
    run_one.add_argument("--dry-run-searches", action="store_true")

    run_csv = subparsers.add_parser("run-csv", help="Run pipeline for CSV input")
    run_csv.add_argument("--input", required=True, help="Path to input CSV")
    run_csv.add_argument("--output", required=True, help="Path to output JSONL")
    run_csv.add_argument("--max-results", type=int, default=5)
    run_csv.add_argument("--include-raw-content", action="store_true")
    run_csv.add_argument("--dry-run-searches", action="store_true")

    return parser


def main() -> None:
    args = build_parser().parse_args()

    if args.command == "run-one":
        lead = Lead.model_validate(json.loads(args.lead_json))
        if args.dry_run_searches:
            print(json.dumps(prepare_queries_for_lead(lead), indent=2))
            return

        result = run_pipeline_for_lead(
            lead,
            max_results=args.max_results,
            include_raw_content=args.include_raw_content,
        )
        print(result.model_dump_json(indent=2))
        return

    if args.command == "run-csv":
        if args.dry_run_searches:
            print(json.dumps(prepare_queries_for_csv(args.input), indent=2))
            return

        run_pipeline_for_csv(
            args.input,
            args.output,
            max_results=args.max_results,
            include_raw_content=args.include_raw_content,
        )
        print(json.dumps({"status": "ok", "output": args.output}, indent=2))
        return

    raise SystemExit(f"Unknown command: {args.command}")


if __name__ == "__main__":
    main()
