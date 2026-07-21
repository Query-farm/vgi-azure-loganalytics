// The VGI table function: loganalytics_query. A KQL passthrough with an optional
// synthesized TimeGenerated watermark for incremental use. The GraphClient (bound to
// the loganalytics audience) is injected so the worker wires the real MSAL-backed
// client and tests inject a fake.
//
// All cursors are TABLE functions so `name := value` works; the optional args live in
// argDefaults so they are named (timespan := 'PT1H', since := '<iso>'). State is fully
// serializable — a `done` flag plus plain string args, no socket / RecordBatch / Date.

import { defineTableFunction, secretsOfType, type OutputCollector } from "@query-farm/vgi";
import { Utf8 } from "@query-farm/apache-arrow";
import { runQuery } from "./laquery.js";
import { laSchema, buildBatch } from "./schema.js";
import type { GraphClient } from "@vgi-azure/graph-core";

export type ClientFactory = (secret: Record<string, unknown>) => GraphClient;

interface Args {
  /** The KQL text, verbatim — the worker never parses or rewrites it (passthrough). */
  kql: string;
  /** The workspace GUID (the {workspaceId} path segment). */
  workspace: string;
  /** ISO-8601 interval: a duration (PT1H, P1D) or absolute range. Ignored when `since` is set. */
  timespan: string;
  /** Incremental convenience: an ISO instant (a prior `_watermark_next`). "" → full pull. */
  since: string;
}
interface State {
  done: boolean;
}

export function makeQueryFunction(clientFactory: ClientFactory) {
  const schema = laSchema();
  return defineTableFunction<Args, State>({
    name: "loganalytics_query",
    description:
      "Azure Monitor / Log Analytics KQL passthrough: KQL in, one JSON `result` string per row. " +
      "Optional TimeGenerated watermark (since := <iso>) for incremental pulls (at-least-once " +
      "within the safety lag). Large pulls (>~500k rows / 64MB) must be time-sliced by the caller.",
    args: { kql: new Utf8(), workspace: new Utf8(), timespan: new Utf8(), since: new Utf8() },
    argDefaults: { timespan: "P1D", since: "" },
    argDocs: {
      kql:
        "The Kusto (KQL) query text, sent to Log Analytics verbatim — the worker never parses or " +
        "rewrites it (passthrough). Required. For incremental (watermark) use, project `TimeGenerated` " +
        "in the query so a cursor can be synthesized.",
      workspace:
        "The Log Analytics workspace ID (GUID) to query — the `{workspaceId}` path segment. Required.",
      timespan:
        "The scan window as an ISO-8601 duration (e.g. `PT1H`, `P1D`) or an absolute `start/end` range. " +
        "Ignored when `since` is set (incremental use derives its own range). Defaults to `P1D` (last day).",
      since:
        "Incremental cursor: an ISO-8601 instant, typically a prior scan's `_watermark_next` value. When " +
        "set, the function fetches only rows newer than this watermark (at-least-once within a safety lag) " +
        "and emits the next cursor on the marker row. Empty (the default) performs a full `timespan` pull " +
        "with no marker row.",
    },
    examples: [
      {
        sql: "SELECT result FROM azure.main.loganalytics_query('AuditLogs | take 100', '<workspace-guid>') WHERE _row_kind IS NULL",
        description: "Snapshot of the 100 most recent audit-log entries over the default P1D window",
      },
      {
        sql: "SELECT result FROM azure.main.loganalytics_query('SigninLogs | summarize count() by ResultType', '<workspace-guid>', timespan := 'PT1H') WHERE _row_kind IS NULL",
        description: "Aggregate sign-in events by result type over the last hour",
      },
      {
        sql: "SELECT result FROM azure.main.loganalytics_query('SigninLogs | project TimeGenerated, UserPrincipalName', '<workspace-guid>', since := '<prior _watermark_next>') WHERE _row_kind IS NULL",
        description: "Incremental pull of new sign-ins replaying a saved TimeGenerated watermark",
      },
      {
        sql: "SELECT _watermark_next FROM azure.main.loganalytics_query('SigninLogs | project TimeGenerated', '<workspace-guid>', since := '2026-01-01T00:00:00Z') WHERE _row_kind = 'marker'",
        description: "Read the watermark cursor to persist for the next incremental scan",
      },
    ],
    tags: {
      "vgi.category": "log-analytics-query",
      "vgi.title": "Log Analytics KQL Query",
      "vgi.keywords": JSON.stringify([
        "azure monitor",
        "log analytics",
        "kql",
        "kusto",
        "logs",
        "query",
        "passthrough",
        "watermark",
        "incremental",
        "timegenerated",
      ]),
      "vgi.doc_llm":
        "Run an arbitrary Kusto (KQL) query against an Azure Monitor / Log Analytics workspace and get " +
        "the results back as SQL rows. The KQL text (`kql`) is sent verbatim to the workspace (`workspace`, " +
        "a GUID); each Kusto result row is returned as one JSON `result` string (all its projected columns " +
        "encoded together, since the output schema is fixed for any KQL). A snapshot call reads a `timespan` " +
        "window (default P1D). For incremental use, project `TimeGenerated` in the KQL and pass " +
        "`since := '<prior _watermark_next>'`: the function returns rows newer than that watermark " +
        "(at-least-once within a safety lag) followed by one marker row whose `_watermark_next` is the " +
        "cursor to persist. Requires an app-only `azure_graph` secret with workspace read access.",
      "vgi.doc_md":
        "## loganalytics_query\n\n" +
        "KQL passthrough to an Azure Monitor / Log Analytics workspace. The `kql` text is sent verbatim; " +
        "each Kusto result row comes back as one JSON `result` string. Read data rows by filtering " +
        "`_row_kind IS NULL`. For incremental pulls, project `TimeGenerated`, pass `since`, and take " +
        "the next cursor from the marker row's `_watermark_next` (the marker row is the one whose " +
        "`_row_kind` equals `marker`).\n\n" +
        "A snapshot call reads the `timespan` window (default `P1D`); an incremental call projects " +
        "`TimeGenerated`, passes `since`, and takes the next cursor from the marker row's `_watermark_next`. " +
        "Aggregations (`summarize`) run server-side in the workspace and come back one JSON `result` per " +
        "group. Large result sets (>~500k rows / 64MB) must be time-sliced by the caller via `timespan` or " +
        "`since`. Requires an app-only `azure_graph` secret with workspace read access.",
      // The native duckdb_functions().examples carrier drops descriptions under the
      // current FunctionInfo schema, so the described examples are re-surfaced here as
      // the coverage-checked vgi.example_queries JSON tag (VGI515), byte-identical to
      // the `examples` array above.
      "vgi.example_queries": JSON.stringify([
        {
          description: "Snapshot of the 100 most recent audit-log entries over the default P1D window",
          sql: "SELECT result FROM azure.main.loganalytics_query('AuditLogs | take 100', '<workspace-guid>') WHERE _row_kind IS NULL",
        },
        {
          description: "Aggregate sign-in events by result type over the last hour",
          sql: "SELECT result FROM azure.main.loganalytics_query('SigninLogs | summarize count() by ResultType', '<workspace-guid>', timespan := 'PT1H') WHERE _row_kind IS NULL",
        },
        {
          description: "Incremental pull of new sign-ins replaying a saved TimeGenerated watermark",
          sql: "SELECT result FROM azure.main.loganalytics_query('SigninLogs | project TimeGenerated, UserPrincipalName', '<workspace-guid>', since := '<prior _watermark_next>') WHERE _row_kind IS NULL",
        },
        {
          description: "Read the watermark cursor to persist for the next incremental scan",
          sql: "SELECT _watermark_next FROM azure.main.loganalytics_query('SigninLogs | project TimeGenerated', '<workspace-guid>', since := '2026-01-01T00:00:00Z') WHERE _row_kind = 'marker'",
        },
      ]),
      "vgi.result_columns_schema": JSON.stringify([
        {
          name: "result",
          type: "VARCHAR",
          description:
            "One Kusto result row encoded as a JSON object string, keyed by the KQL query's projected column names. NULL on the marker row.",
        },
        {
          name: "_row_kind",
          type: "VARCHAR",
          description:
            "NULL for business data rows; the literal 'marker' for the single trailing cursor row (present only on an incremental `since` pull).",
        },
        {
          name: "_watermark_next",
          type: "VARCHAR",
          description:
            "On the marker row, the clamped ISO-8601 `TimeGenerated` watermark to persist and replay via the `since` argument; NULL on data rows (and no marker row is emitted at all on a non-incremental full pull).",
        },
      ]),
    },
    onBind: () => ({ outputSchema: schema }),
    initialState: () => ({ done: false }),
    process: async (p, state: State, out: OutputCollector) => {
      if (state.done) {
        out.finish();
        return;
      }
      const secret = secretsOfType(p.secrets, "azure_graph")[0];
      if (!secret) throw new Error("loganalytics_query: attach an 'azure_graph' secret (TYPE azure_graph)");
      const client = clientFactory(secret as Record<string, unknown>);
      const { results, watermarkNext } = await runQuery(client.postJson, {
        kql: p.args.kql,
        workspace: p.args.workspace,
        timespan: p.args.timespan,
        since: p.args.since,
      });
      out.emit(buildBatch(schema, results, watermarkNext));
      state.done = true; // next process() call hits the done branch and finishes.
    },
  });
}
