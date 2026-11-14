"""Explicit synthetic Log Analytics HTTP fixture; no KQL interpreter or live fallback.

The Kusto tables/columns/rows envelope follows test/fake-loganalytics.ts in the
pinned MIT source. Only the notebook's exact projection and fixed date range
are supported. Every quantity, table observation and timestamp is invented.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

QUERY = "Usage | project TimeGenerated, DataType, Quantity, QuantityUnit"
WORKSPACE = "11111111-2222-3333-4444-555555555555"
START = datetime(2026, 6, 18, tzinfo=UTC)
END = datetime(2026, 6, 25, tzinfo=UTC)
COLUMNS = [
    {"name": "TimeGenerated", "type": "datetime"},
    {"name": "DataType", "type": "string"},
    {"name": "Quantity", "type": "real"},
    {"name": "QuantityUnit", "type": "string"},
]


def synthetic_rows():
    quantities = {
        "SigninLogs": [80, 90, 100, 120, 150, 200, 260],
        "AzureDiagnostics": [600, 500, 400, 100, 80, 70, 50],
        "AuditLogs": [20] * 7,
        "Heartbeat": [5] * 7,
        "CustomPipeline_CL": [30] * 7,
        "AzureActivity": [0] * 7,
    }
    rows = []
    for table, values in quantities.items():
        for offset, quantity in enumerate(values):
            stamp = START + timedelta(days=offset, hours=12)
            rows.append([stamp.isoformat().replace("+00:00", "Z"), table, quantity, "MBytes"])
    rows.append(["2026-06-22T18:00:00Z", "AzureDiagnostics", None, "MBytes"])
    rows.append(["2026-06-23T18:00:00Z", "Unmapped_CL", 5, "packets"])
    return rows


class SyntheticLogAnalyticsApi:
    def __init__(self):
        self.requests = []
        self.server = None
        self.thread = None

    def start(self):
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                try:
                    if self.path != f"/v1/workspaces/{WORKSPACE}/query":
                        raise ValueError("Unsupported synthetic workspace or endpoint")
                    body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
                    if set(body) != {"query", "timespan"} or body["query"] != QUERY:
                        raise ValueError("Only the notebook's exact KQL projection is supported")
                    lo_text, hi_text = body["timespan"].split("/")
                    lo, hi = datetime.fromisoformat(lo_text), datetime.fromisoformat(hi_text)
                    if lo.tzinfo is None or hi.tzinfo is None or not START <= lo < hi <= END:
                        raise ValueError("Use an aware UTC interval inside 18–25 June 2026")
                    rows = [r for r in synthetic_rows() if lo <= datetime.fromisoformat(r[0]) < hi]
                    fixture.requests.append({"path": self.path, **body, "returned_rows": len(rows)})
                    payload = {"tables": [{"name": "PrimaryResult", "columns": COLUMNS, "rows": rows}]}
                    status = 200
                except (ValueError, KeyError, TypeError) as exc:
                    payload, status = {"error": str(exc)}, 400
                encoded = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        return self

    def stop(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        if self.thread:
            self.thread.join(timeout=2)
