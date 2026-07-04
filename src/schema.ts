// Arrow output schema + row→batch mapping for loganalytics_query.
//
// Committee default (SPEC §4, task fix): a SINGLE Utf8 `result` column — one JSON
// string per Kusto row — instead of a dynamically-probed per-KQL schema (which is
// unsound: the probe can't see a column that only appears in later rows). This keeps
// the output schema STABLE for any KQL, so the watermark path emits business rows +
// one marker under one schema.
//
// Marker-row contract (graph-core §D): business rows carry `_row_kind` null; exactly
// ONE `_row_kind='marker'` row carries the cursor column `_watermark_next` with the
// business `result` column null. The marker (and the cursor column value) exist ONLY
// when `since` was given — a non-incremental full pull has no cross-scan cursor.

import { Schema, Field, Utf8 } from "@query-farm/apache-arrow";
import { batchFromColumns } from "@query-farm/vgi";
import { ROW_KIND, MARKER, WATERMARK_NEXT } from "@vgi-azure/graph-core";

/** The default single-column result schema + the two control columns. */
export function laSchema(): Schema {
  return new Schema([
    new Field("result", new Utf8(), true),
    new Field(ROW_KIND, new Utf8(), true),
    new Field(WATERMARK_NEXT, new Utf8(), true),
  ]);
}

/**
 * Build one Arrow batch: the business rows (each a JSON `result` string, `_row_kind`
 * null) followed — ONLY when `watermarkNext` is non-null — by exactly ONE marker row
 * (`result` null, `_row_kind='marker'`, `_watermark_next` = the clamped ISO watermark).
 *
 * A full pull (`since` absent → `watermarkNext` null) emits data rows and NO marker,
 * because a snapshot/non-incremental scan has no cross-scan cursor to carry.
 */
export function buildBatch(schema: Schema, results: string[], watermarkNext: string | null) {
  const cols: Record<string, unknown[]> = { result: [], [ROW_KIND]: [], [WATERMARK_NEXT]: [] };

  for (const r of results) {
    cols.result!.push(r);
    cols[ROW_KIND]!.push(null);
    cols[WATERMARK_NEXT]!.push(null);
  }

  if (watermarkNext !== null) {
    cols.result!.push(null);
    cols[ROW_KIND]!.push(MARKER);
    cols[WATERMARK_NEXT]!.push(watermarkNext);
  }

  return batchFromColumns(cols, schema);
}
