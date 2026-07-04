// THE archetype proof for vgi-azure-loganalytics: a KQL passthrough with an optional
// synthesized TimeGenerated watermark. Imports ONLY @vgi-azure/graph-core + our own
// src + bun:test — NO @query-farm/* — so it runs without the SDK installed.
//
// It exercises the pure driver (laquery.ts) end to end against an in-process fake LA
// server, proving:
//   1. each Kusto row becomes a JSON `result` string (the committee default schema);
//   2. the POST body carried the caller's KQL + the resolved timespan;
//   3. `since` given → a watermark is synthesized from max(TimeGenerated), CLAMPED
//      through graph-core clampWatermark (lag behind maxSeen), and round-trips as the
//      next scan's `since` (at-least-once cursor);
//   4. no `since` → no watermark (a non-incremental full pull has no cross-scan cursor).

import { test, expect } from "bun:test";
import { clampWatermark, isoToMs, msToIso } from "@vgi-azure/graph-core";
import { runQuery, resolveTimespan, LAG_MS } from "../src/laquery.js";
import { FakeLogAnalytics } from "./fake-loganalytics.js";

const WS = "11111111-2222-3333-4444-555555555555";
const COLS = [
  { name: "TimeGenerated", type: "datetime" },
  { name: "Computer", type: "string" },
  { name: "Level", type: "long" },
  { name: "Props", type: "dynamic" },
];

function fake() {
  return FakeLogAnalytics.fromRows(COLS, [
    { TimeGenerated: "2026-06-30T10:00:00.000Z", Computer: "host-a", Level: 4, Props: { a: 1 } },
    { TimeGenerated: "2026-06-30T10:05:00.000Z", Computer: "host-b", Level: 2, Props: { a: 2 } },
    { TimeGenerated: "2026-06-30T10:03:00.000Z", Computer: "host-c", Level: 3, Props: null },
  ]);
}

test("each Kusto row becomes ONE JSON `result` string keyed by column name", async () => {
  const g = fake();
  const r = await runQuery(g.postJson, { kql: "Heartbeat | take 3", workspace: WS, timespan: "PT1H", since: "" });

  expect(r.results.length).toBe(3);
  const first = JSON.parse(r.results[0]!);
  expect(first).toEqual({ TimeGenerated: "2026-06-30T10:00:00.000Z", Computer: "host-a", Level: 4, Props: { a: 1 } });
  // dynamic is preserved as nested JSON (never flattened), null cells stay null.
  expect(JSON.parse(r.results[2]!).Props).toBeNull();
});

test("the POST body carried the caller's KQL verbatim + the resolved timespan", async () => {
  const g = fake();
  const kql = "SecurityEvent | where EventID == 4625 | project TimeGenerated, Computer";
  await runQuery(g.postJson, { kql, workspace: WS, timespan: "PT1H", since: "" });

  expect(g.calls.length).toBe(1);
  expect(g.calls[0]!.url).toContain(`/v1/workspaces/${WS}/query`);
  expect(g.calls[0]!.query).toBe(kql); // passthrough — never parsed or rewritten
  expect(g.calls[0]!.timespan).toBe("PT1H"); // full pull uses the caller's timespan verbatim
});

test("full pull (no `since`) emits NO watermark — a non-incremental scan has no cursor", async () => {
  const g = fake();
  const r = await runQuery(g.postJson, { kql: "Perf | take 3", workspace: WS, timespan: "P1D", since: "" });
  expect(r.watermarkNext).toBeNull();
});

test("incremental (`since` given): watermark = clampWatermark(max(TimeGenerated), lag, now)", async () => {
  const g = fake();
  const since = "2026-06-30T09:00:00.000Z";
  const nowMs = isoToMs("2026-06-30T12:00:00.000Z");

  const r = await runQuery(
    g.postJson,
    { kql: "Heartbeat | project TimeGenerated, Computer", workspace: WS, timespan: "P1D", since },
    undefined,
    nowMs,
    LAG_MS,
  );

  // maxSeen across the three rows is 10:05; clamp floors it `lag` behind maxSeen
  // (maxSeen << now, so min(maxSeen, now) = maxSeen).
  const maxSeenMs = isoToMs("2026-06-30T10:05:00.000Z");
  const expected = msToIso(clampWatermark(maxSeenMs, LAG_MS, nowMs));
  expect(r.watermarkNext).toBe(expected);
  expect(isoToMs(r.watermarkNext!)).toBe(maxSeenMs - LAG_MS); // exactly lag behind maxSeen

  // `since` present → the request timespan is an absolute [since−overlap, now−lag] range
  // with an inclusive lower bound (the ge overlap-window boundary).
  const lo = msToIso(isoToMs(since) - LAG_MS);
  const hi = msToIso(nowMs - LAG_MS);
  expect(g.calls[0]!.timespan).toBe(`${lo}/${hi}`);
  expect(resolveTimespan({ timespan: "P1D", since }, nowMs, LAG_MS)).toBe(`${lo}/${hi}`);
});

test("the synthesized watermark round-trips as the next scan's `since` (at-least-once cursor)", async () => {
  // Scan 1: pull, capture W1.
  const g1 = fake();
  const now1 = isoToMs("2026-06-30T12:00:00.000Z");
  const r1 = await runQuery(
    g1.postJson,
    { kql: "Heartbeat | project TimeGenerated, Computer", workspace: WS, timespan: "P1D", since: "2026-06-30T09:00:00.000Z" },
    undefined,
    now1,
    LAG_MS,
  );
  const W1 = r1.watermarkNext!;
  expect(W1).not.toBeNull();

  // Scan 2: feed W1 back as `since`. The window re-reads [W1−overlap, now−lag], so
  // rows in the overlap band are re-emitted (at-least-once; caller dedups). A fresh
  // watermark is produced again — the cursor advances monotonically with the data.
  const g2 = fake();
  const now2 = isoToMs("2026-06-30T12:30:00.000Z");
  const r2 = await runQuery(
    g2.postJson,
    { kql: "Heartbeat | project TimeGenerated, Computer", workspace: WS, timespan: "P1D", since: W1 },
    undefined,
    now2,
    LAG_MS,
  );

  const loExpected = msToIso(isoToMs(W1) - LAG_MS);
  expect(g2.calls[0]!.timespan.startsWith(loExpected + "/")).toBe(true);
  expect(r2.watermarkNext).not.toBeNull();
});
