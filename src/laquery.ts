// The Log Analytics KQL driver — pure logic over graph-core, no SDK / no network.
// A thin, honest KQL passthrough: KQL in, one canned Kusto tables[] envelope back,
// each result row projected to a single JSON string (the committee's default schema,
// which sidesteps the unsound dynamic-schema probe). Optional TimeGenerated watermark
// for incremental use. This is the module the archetype-proof test exercises.
//
// SPEC: ~/Development/vgi-tasker/vgi-azure-loganalytics-SPEC.md
// AUDIENCE: loganalytics (api.loganalytics.io) — proves graph-core multi-audience.

import { clampWatermark, isoToMs, msToIso } from "@vgi-azure/graph-core";

/** The query host. The newer alias api.loganalytics.azure.com shares this audience. */
export const LA_HOST = "https://api.loganalytics.io";

/** Safety lag (§3): never commit/query a watermark closer to `now` than this. */
export const LAG_MS = 5 * 60 * 1000;

/** A Kusto column descriptor as returned in the tables[] envelope. */
export interface KustoColumn {
  name: string;
  type: string;
}

/** One Kusto table in the response envelope. */
export interface KustoTable {
  name?: string;
  columns: KustoColumn[];
  rows: unknown[][];
}

/** The raw Log Analytics query response envelope. */
export interface KustoEnvelope {
  tables: KustoTable[];
}

/** Build the query endpoint URL for a workspace GUID. */
export function queryUrl(workspace: string, host: string = LA_HOST): string {
  return `${host}/v1/workspaces/${encodeURIComponent(workspace)}/query`;
}

/** Build the POST body. `timespan` is an ISO-8601 duration (PT1H) or absolute range. */
export function queryBody(kql: string, timespan: string): { query: string; timespan: string } {
  return { query: kql, timespan };
}

/**
 * Resolve the effective timespan for a scan.
 *  - `since` present (incremental): absolute range `[since − overlap, now − lag]`
 *    with a `ge` (inclusive) lower bound — the canonical overlap-window boundary
 *    (SPEC §3). overlap defaults to lag.
 *  - `since` absent: the caller's `timespan` verbatim (a duration or absolute range).
 */
export function resolveTimespan(
  args: { timespan: string; since: string },
  nowMs: number = Date.now(),
  lagMs: number = LAG_MS,
): string {
  if (!args.since) return args.timespan;
  const loMs = isoToMs(args.since) - lagMs; // overlap = lag
  const hiMs = nowMs - lagMs;
  return `${msToIso(loMs)}/${msToIso(hiMs)}`;
}

/** The primary result table (Log Analytics returns it first / as PrimaryResult). */
export function primaryTable(env: KustoEnvelope): KustoTable {
  const t = env.tables[0];
  if (!t) throw new Error("loganalytics: response carried no tables[]");
  return t;
}

/**
 * Project one Kusto row (array of scalars, positional to `columns`) to a plain
 * object keyed by column name. `dynamic` cells arrive already-parsed from JSON;
 * we keep them as-is and JSON-encode the whole object downstream.
 */
export function rowToObject(columns: KustoColumn[], row: unknown[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) obj[columns[i]!.name] = row[i] ?? null;
  return obj;
}

/** The default projection: each Kusto row becomes ONE JSON string (schema §4 default). */
export function rowToJson(columns: KustoColumn[], row: unknown[]): string {
  return JSON.stringify(rowToObject(columns, row));
}

/** Extract the TimeGenerated cell (ISO string) from a row, or null if absent/null. */
export function timeGeneratedOf(columns: KustoColumn[], row: unknown[]): string | null {
  const idx = columns.findIndex((c) => c.name === "TimeGenerated");
  if (idx < 0) return null;
  const v = row[idx];
  return v == null ? null : String(v);
}

export interface QueryResult {
  /** One JSON string per Kusto row (the default single-`result`-column schema). */
  results: string[];
  /** The clamped ISO watermark to persist, or null when `since` was not requested. */
  watermarkNext: string | null;
}

/**
 * Run one KQL query over the resolved timespan and project it to the default schema.
 *
 * `since` present → incremental: also fold max(TimeGenerated) across the returned
 * rows and emit the CLAMPED watermark `clampWatermark(maxSeen, lag, now)` (SPEC §3,
 * step 4). The KQL MUST project TimeGenerated for the watermark to exist; if it
 * doesn't, `watermarkNext` is null (no non-resumable authoritative watermark).
 *
 * The loss-safety contract lives in the CALLER: persist `watermarkNext` only after
 * the rows are durably applied. On crash the caller still holds the old `since` and
 * re-reads `[since − overlap, now − lag]` — at-least-once with caller-side dedup.
 */
export async function runQuery(
  postJson: (url: string, body: unknown) => Promise<Record<string, unknown>>,
  args: { kql: string; workspace: string; timespan: string; since: string },
  host: string = LA_HOST,
  nowMs: number = Date.now(),
  lagMs: number = LAG_MS,
): Promise<QueryResult> {
  const timespan = resolveTimespan(args, nowMs, lagMs);
  const env = (await postJson(queryUrl(args.workspace, host), queryBody(args.kql, timespan))) as unknown as KustoEnvelope;
  const table = primaryTable(env);

  const results: string[] = [];
  let maxSeenMs: number | null = null;
  for (const row of table.rows) {
    results.push(rowToJson(table.columns, row));
    if (args.since) {
      const tg = timeGeneratedOf(table.columns, row);
      if (tg) {
        const ms = isoToMs(tg);
        if (maxSeenMs === null || ms > maxSeenMs) maxSeenMs = ms;
      }
    }
  }

  const watermarkNext =
    args.since && maxSeenMs !== null ? msToIso(clampWatermark(maxSeenMs, lagMs, nowMs)) : null;

  return { results, watermarkNext };
}
