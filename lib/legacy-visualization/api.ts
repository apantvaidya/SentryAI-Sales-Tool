import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const leadGenRoot = path.join(process.cwd(), "lead_generation_mod");

type LegacyFunction =
  | "runs"
  | "graph"
  | "aggregate"
  | "overlap"
  | "query_results"
  | "query_overlap";

export async function legacyVisualizationPayload(fn: LegacyFunction, params: Record<string, string | undefined> = {}) {
  const script = String.raw`
from pathlib import Path
import json
import sys

from visualize.graph_data import (
    build_aggregate_graph_payload,
    build_graph_payload,
    build_overlap_payload,
    build_query_overlap_detail_from_node_ids,
    build_query_results_payload,
    latest_run_id,
    run_ids,
)

fn = sys.argv[1]
params = json.loads(sys.argv[2])
data_dir = Path("data")

if fn == "runs":
    payload = {"runs": run_ids(data_dir), "latest": latest_run_id(data_dir)}
elif fn == "graph":
    payload = build_graph_payload(data_dir, params.get("run_id"))
elif fn == "aggregate":
    payload = build_aggregate_graph_payload(data_dir)
elif fn == "overlap":
    payload = build_overlap_payload(data_dir, params.get("run_id"))
elif fn == "query_results":
    payload = build_query_results_payload(data_dir, params["run_id"], params["vector_id"])
elif fn == "query_overlap":
    payload = build_query_overlap_detail_from_node_ids(
        data_dir,
        left_query_id=params["left_query_id"],
        right_query_id=params["right_query_id"],
    )
else:
    raise ValueError(f"Unknown legacy visualization function: {fn}")

print(json.dumps(payload, ensure_ascii=True))
`;

  const { stdout } = await execFileAsync("python3", ["-c", script, fn, JSON.stringify(params)], {
    cwd: leadGenRoot,
    env: {
      ...process.env,
      PYTHONPATH: leadGenRoot
    },
    maxBuffer: 1024 * 1024 * 24
  });
  return JSON.parse(stdout);
}
