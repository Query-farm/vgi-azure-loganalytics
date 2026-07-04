// A tiny in-process fake of the Log Analytics query endpoint — enough to prove the
// KQL-passthrough + watermark archetype: it records the POST body it was handed (so
// the test can assert the KQL + timespan crossed the wire) and returns a canned
// Kusto tables[] envelope. No network. Used only by the archetype-proof test.
//
// Shape mirrors directory/test/fake-graph.ts: a stateful fake with a postJson method
// matching graph-core's GraphClient.postJson(url, body) signature.

export interface CannedRow {
  [column: string]: unknown;
}

/** A recorded POST: the URL and the parsed {query, timespan} body. */
export interface Captured {
  url: string;
  query: string;
  timespan: string;
}

export class FakeLogAnalytics {
  /** Every POST this fake received, in order (assert the wire contract on these). */
  readonly calls: Captured[] = [];

  constructor(
    private readonly columns: { name: string; type: string }[],
    private readonly rows: unknown[][],
  ) {}

  /** Build a fake from column defs + row-objects (fills cells positionally). */
  static fromRows(columns: { name: string; type: string }[], rowObjs: CannedRow[]): FakeLogAnalytics {
    const rows = rowObjs.map((o) => columns.map((c) => o[c.name] ?? null));
    return new FakeLogAnalytics(columns, rows);
  }

  /** Matches graph-core GraphClient.postJson(url, body) → Kusto tables[] envelope. */
  postJson = async (url: string, body: unknown): Promise<Record<string, unknown>> => {
    const b = body as { query: string; timespan: string };
    this.calls.push({ url, query: b.query, timespan: b.timespan });
    return {
      tables: [{ name: "PrimaryResult", columns: this.columns, rows: this.rows }],
    };
  };
}
