// Marker-row contract for the loganalytics schema. This one touches buildBatch, which
// pulls @query-farm/vgi (batchFromColumns), so it runs under the full SDK install —
// unlike archetype-proof.test.ts, which is deliberately SDK-free.

import { test, expect } from "bun:test";
import { laSchema, buildBatch } from "../src/schema.js";

test("schema columns: result + control (_row_kind, _watermark_next)", () => {
  expect(laSchema().fields.map((f) => f.name)).toEqual(["result", "_row_kind", "_watermark_next"]);
});

test("incremental buildBatch: N result rows + exactly 1 marker carrying _watermark_next", () => {
  const schema = laSchema();
  const results = ['{"Computer":"a"}', '{"Computer":"b"}'];
  const batch = buildBatch(schema, results, "2026-06-30T10:00:00.000Z") as { numRows: number };
  expect(batch.numRows).toBe(3); // 2 data + 1 marker
});

test("full pull (watermarkNext null): NO marker row — snapshot scans have no cursor", () => {
  const schema = laSchema();
  const batch = buildBatch(schema, ['{"Computer":"a"}', '{"Computer":"b"}'], null) as { numRows: number };
  expect(batch.numRows).toBe(2); // data only, no marker
});

test("empty incremental result still emits the marker row so the cursor advances", () => {
  const schema = laSchema();
  const batch = buildBatch(schema, [], "2026-06-30T10:00:00.000Z") as { numRows: number };
  expect(batch.numRows).toBe(1);
});
