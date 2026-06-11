from __future__ import annotations

from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import json

from .graph_data import (
    build_aggregate_graph_payload,
    build_graph_payload,
    build_overlap_payload,
    build_query_overlap_detail_from_node_ids,
    build_query_results_payload,
    build_seed_searches_payload,
    latest_run_id,
    run_ids,
)


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
VISUALIZE_DIR = PROJECT_ROOT / "visualize"


class VisualizeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(VISUALIZE_DIR), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/runs":
            self._write_json({"runs": run_ids(DATA_DIR), "latest": latest_run_id(DATA_DIR)})
            return
        if parsed.path == "/api/graph":
            params = parse_qs(parsed.query)
            run_id = params.get("run_id", [None])[0]
            self._write_json(build_graph_payload(DATA_DIR, run_id))
            return
        if parsed.path == "/api/aggregate":
            self._write_json(build_aggregate_graph_payload(DATA_DIR))
            return
        if parsed.path == "/api/seed-searches":
            self._write_json(build_seed_searches_payload(DATA_DIR))
            return
        if parsed.path == "/api/query-results":
            params = parse_qs(parsed.query)
            run_id = params.get("run_id", [None])[0]
            vector_id = params.get("vector_id", [None])[0]
            if not run_id or not vector_id:
                self._write_error(HTTPStatus.BAD_REQUEST, "run_id and vector_id are required")
                return
            self._write_json(build_query_results_payload(DATA_DIR, run_id, vector_id))
            return
        if parsed.path == "/api/query-overlap":
            params = parse_qs(parsed.query)
            values = {
                "left_query_id": params.get("left_query_id", [None])[0],
                "right_query_id": params.get("right_query_id", [None])[0],
            }
            if any(value is None for value in values.values()):
                self._write_error(HTTPStatus.BAD_REQUEST, "both query overlap references are required")
                return
            self._write_json(build_query_overlap_detail_from_node_ids(DATA_DIR, **values))
            return
        if parsed.path == "/api/overlap":
            params = parse_qs(parsed.query)
            run_id = params.get("run_id", [None])[0]
            self._write_json(build_overlap_payload(DATA_DIR, run_id))
            return
        if parsed.path == "/api/graph/latest":
            self._write_json(build_graph_payload(DATA_DIR))
            return
        if parsed.path == "/api/overlap/latest":
            self._write_json(build_overlap_payload(DATA_DIR))
            return
        if parsed.path in {"/", ""}:
            self.path = "/index.html"
        super().do_GET()

    def _write_json(self, payload: dict) -> None:
        encoded = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _write_error(self, status: HTTPStatus, message: str) -> None:
        encoded = json.dumps({"error": message}, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    host = "127.0.0.1"
    port = 8765
    server = ThreadingHTTPServer((host, port), VisualizeHandler)
    print(f"Serving visualization at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
