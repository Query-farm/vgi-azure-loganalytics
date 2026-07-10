// The `azure` catalog descriptor + the azure_graph secret type. The secret shape is
// the SAME frozen app-only client-credentials type directory owns (§7): tenant_id,
// client_id, client_secret[redact]. Only the token AUDIENCE differs (loganalytics),
// and that is set in worker.ts's clientFactory, not here.

import { Schema, Field, Utf8 } from "@query-farm/apache-arrow";
import type { CatalogDescriptor, SecretTypeDescriptor, ViewDescriptor, VgiFunction } from "@query-farm/vgi";

const REPO = "https://github.com/Query-farm/vgi-azure-loganalytics";
const ISSUES = `${REPO}/issues`;

export const AZURE_GRAPH_SECRET: SecretTypeDescriptor = {
  name: "azure_graph",
  description: "Microsoft Entra app-only (client-credentials) credentials for Azure Monitor / Log Analytics",
  schema: new Schema([
    new Field("tenant_id", new Utf8(), true),
    new Field("client_id", new Utf8(), true),
    new Field("client_secret", new Utf8(), true, new Map([["redact", "true"]])),
  ]),
};

/** Catalog-level tags: docs, discovery, provenance, and the agent-test suite. */
const CATALOG_TAGS: Record<string, string> = {
  "vgi.title": "Azure Monitor Log Analytics",
  "vgi.doc_llm":
    "Azure Monitor / Log Analytics KQL passthrough as a single SQL table function. Reach for it to " +
    "run an arbitrary Kusto (KQL) query against a Log Analytics workspace and get the results back as " +
    "SQL rows: the KQL text is sent verbatim (never parsed or rewritten) and each Kusto result row is " +
    "returned as one JSON `result` string. Supports incremental (watermark) pulls: project " +
    "`TimeGenerated` in the KQL and pass `since := '<prior _watermark_next>'` to fetch only rows newer " +
    "than the last cursor (at-least-once within a safety lag), with the next cursor emitted on a marker " +
    "row. A non-incremental call pulls a `timespan` window (default P1D). Large result sets (>~500k " +
    "rows / 64MB) must be time-sliced by the caller. Requires an app-only (client-credentials) " +
    "'azure_graph' secret (tenant_id, client_id, client_secret) whose service principal has read access " +
    "to the target Log Analytics workspace (the token is minted for the api.loganalytics.io audience).",
  "vgi.doc_md":
    "## Azure Monitor Log Analytics\n\n" +
    "KQL passthrough to an Azure Monitor / Log Analytics workspace, exposed as one DuckDB table " +
    "function.\n\n" +
    "- **`loganalytics_query`** — run verbatim KQL against a workspace; each Kusto row is returned as " +
    "one JSON `result` string, with an optional `TimeGenerated` watermark for incremental pulls.\n\n" +
    "Pass the KQL text and workspace GUID (both required). For a snapshot, set `timespan` (an ISO-8601 " +
    "duration/range, default `P1D`). For incremental use, project `TimeGenerated` in the KQL and pass " +
    "`since := '<prior _watermark_next>'`; the function then emits the changed rows plus a single marker " +
    "row (`_row_kind = 'marker'`) whose `_watermark_next` column is the cursor to persist and replay. An " +
    "app-only `azure_graph` secret (Microsoft Entra client credentials) with workspace read access is " +
    "required.",
  "vgi.keywords": JSON.stringify([
    "azure",
    "azure monitor",
    "log analytics",
    "kql",
    "kusto",
    "logs",
    "query",
    "observability",
    "monitoring",
    "telemetry",
    "watermark",
    "incremental",
    "audit logs",
    "sign-in logs",
  ]),
  "vgi.author": "Query Farm LLC",
  "vgi.copyright": "Copyright 2026 Query Farm LLC",
  "vgi.license": "MIT",
  "vgi.support_contact": ISSUES,
  "vgi.support_policy_url": ISSUES,
  // Guaranteed-runnable, catalog-qualified examples (VGI509/VGI906). A LIVE query needs an
  // attached azure_graph secret and a network call to api.loganalytics.io, so this is a
  // credential-free `LIMIT 0` bind probe: onBind runs (and exposes the result columns)
  // without pumping process(), where the secret/network live. `loganalytics_query` takes
  // BOTH kql and workspace positionally with no defaults, so placeholder values (a sample
  // KQL string and the zero GUID) are supplied. Drop the `LIMIT 0` and attach an
  // azure_graph secret to run the KQL for real — the data-returning queries live in the
  // function's `examples` and the schema `vgi.example_queries`.
  "vgi.executable_examples": JSON.stringify([
    {
      name: "query_bind_probe",
      description:
        "Bind loganalytics_query and expose its result columns (credential-free; drop LIMIT 0 and attach an azure_graph secret to run the KQL against a real workspace)",
      sql: "SELECT result, _row_kind, _watermark_next FROM azure.main.loganalytics_query('AzureActivity | take 1', '00000000-0000-0000-0000-000000000000') LIMIT 0",
    },
  ]),
  // The agent-suitability suite (VGI152), catalog only. The loganalytics_query tasks call a
  // live, credential-gated KQL surface that returns workspace-specific, non-deterministic
  // data, so their reference_sql is a representative call (using a placeholder workspace
  // GUID) used only to establish which object each task exercises (VGI520) — the actual
  // grading is by success_criteria (LLM judge), since an exact-compare oracle would need
  // live credentials and stable ground truth. The browse_tables task exercises the
  // credential-free loganalytics_tables discovery view and IS deterministically gradable.
  "vgi.agent_test_tasks": JSON.stringify([
    {
      name: "browse_tables",
      prompt:
        "Before I attach any credentials, which Log Analytics tables can I query here, and what is a good starting KQL for the sign-in table?",
      reference_sql:
        "SELECT table_name, sample_kql FROM azure.main.loganalytics_tables WHERE table_name = 'SigninLogs'",
      success_criteria:
        "The answer reads the loganalytics_tables discovery view (no credentials needed) to list the available tables and surfaces the sample_kql for SigninLogs.",
    },
    {
      name: "recent_signins",
      prompt:
        "Using the Azure Log Analytics workspace, list the 50 most recent sign-in events with their user principal name and time.",
      reference_sql:
        "SELECT result FROM azure.main.loganalytics_query('SigninLogs | project TimeGenerated, UserPrincipalName | take 50', '00000000-0000-0000-0000-000000000000') WHERE _row_kind IS NULL",
      success_criteria:
        "The answer calls azure.main.loganalytics_query with a KQL string like 'SigninLogs | project TimeGenerated, UserPrincipalName | take 50' and a workspace GUID, and reads the returned JSON `result` column (data rows have _row_kind IS NULL).",
    },
    {
      name: "incremental_watermark",
      prompt:
        "I already pulled sign-in logs once. How do I fetch only the rows that are new since my last pull?",
      reference_sql:
        "SELECT _watermark_next FROM azure.main.loganalytics_query('SigninLogs | project TimeGenerated', '00000000-0000-0000-0000-000000000000', since := '2026-01-01T00:00:00Z') WHERE _row_kind = 'marker'",
      success_criteria:
        "The answer projects TimeGenerated in the KQL, reads _watermark_next from the marker row (_row_kind = 'marker') of the prior scan, and replays it via the since := '<iso>' argument on the next loganalytics_query call.",
    },
    {
      name: "audit_count_by_operation",
      prompt:
        "Over the last day in the workspace, how many audit-log entries occurred, and can you break it down by operation name?",
      reference_sql:
        "SELECT result FROM azure.main.loganalytics_query('AuditLogs | summarize count() by OperationName', '00000000-0000-0000-0000-000000000000') WHERE _row_kind IS NULL",
      success_criteria:
        "The answer calls loganalytics_query with a KQL aggregation such as 'AuditLogs | summarize count() by OperationName' and a workspace GUID (default P1D timespan is acceptable), and interprets the JSON `result` strings.",
    },
  ]),
};

/** Schema-level tags: docs, discovery, the category registry, and shown examples. */
const SCHEMA_TAGS: Record<string, string> = {
  "vgi.title": "Log Analytics Query",
  "vgi.doc_llm":
    "The Azure Monitor / Log Analytics query surface: one KQL passthrough table function. It sends the " +
    "supplied Kusto (KQL) query verbatim to a Log Analytics workspace and returns each result row as a " +
    "JSON `result` string. Omit `since` for a snapshot over the `timespan` window (default P1D); project " +
    "`TimeGenerated` and pass `since` for an incremental pull, in which case a trailing marker row " +
    "(`_row_kind = 'marker'`) carries the `_watermark_next` cursor to persist for the next scan.",
  "vgi.doc_md":
    "## Log Analytics query function\n\n" +
    "| Function | Purpose | Returns |\n" +
    "| --- | --- | --- |\n" +
    "| `loganalytics_query` | Run verbatim KQL against a workspace | one JSON `result` per Kusto row (+ optional watermark) |\n\n" +
    "Read data rows with `WHERE _row_kind IS NULL`; on an incremental (`since`) pull, take the next " +
    "cursor from the single marker row's `_watermark_next`. Requires an app-only `azure_graph` secret " +
    "with read access to the target workspace.",
  "vgi.keywords": JSON.stringify([
    "azure monitor",
    "log analytics",
    "kql",
    "kusto",
    "logs",
    "query",
    "observability",
    "monitoring",
    "watermark",
    "incremental",
  ]),
  domain: "observability",
  // Ordered navigation registry; each `name` is referenced by a function's vgi.category.
  "vgi.categories": JSON.stringify([
    {
      name: "log-analytics-query",
      title: "Log Analytics Query",
      description:
        "KQL passthrough queries against Azure Monitor / Log Analytics workspaces, with optional TimeGenerated watermarking for incremental pulls.",
    },
  ]),
  "vgi.example_queries": JSON.stringify([
    {
      description: "Snapshot: the 100 most recent audit-log entries over the last day",
      sql: "SELECT result FROM azure.main.loganalytics_query('AuditLogs | take 100', '<workspace-guid>') WHERE _row_kind IS NULL",
    },
    {
      description: "Count sign-in events by result type over the last hour",
      sql: "SELECT result FROM azure.main.loganalytics_query('SigninLogs | summarize count() by ResultType', '<workspace-guid>', timespan := 'PT1H') WHERE _row_kind IS NULL",
    },
    {
      description: "Incremental pull replaying a saved TimeGenerated watermark",
      sql: "SELECT result FROM azure.main.loganalytics_query('SigninLogs | project TimeGenerated, UserPrincipalName', '<workspace-guid>', since := '<prior _watermark_next>') WHERE _row_kind IS NULL",
    },
    {
      description: "Read the watermark cursor to persist for the next incremental scan",
      sql: "SELECT _watermark_next FROM azure.main.loganalytics_query('SigninLogs | project TimeGenerated', '<workspace-guid>', since := '2026-01-01T00:00:00Z') WHERE _row_kind = 'marker'",
    },
  ]),
};

// A browsable, credential-free discovery view: a curated registry of the Log Analytics
// tables an agent most commonly targets, each with the KQL time column to project for
// watermarking and a ready-to-run starter KQL. Its definition is a self-contained VALUES
// relation evaluated entirely by DuckDB (no worker call, no azure_graph secret), so an
// agent can `SELECT * FROM azure.main.loganalytics_tables` to learn the surface — and a
// good starting KQL — before it ever needs workspace credentials. This is the worker's
// browsable entry point (VGI146): its only other object is the credential-gated
// loganalytics_query table function.
const LOGANALYTICS_TABLES_VIEW: ViewDescriptor = {
  name: "loganalytics_tables",
  definition:
    "SELECT table_name, category, time_column, description, sample_kql FROM (VALUES " +
    "('SigninLogs', 'identity', 'TimeGenerated', 'Microsoft Entra ID interactive user sign-in events.', 'SigninLogs | project TimeGenerated, UserPrincipalName, ResultType | take 100'), " +
    "('AADNonInteractiveUserSignInLogs', 'identity', 'TimeGenerated', 'Microsoft Entra ID non-interactive (token/refresh) sign-in events.', 'AADNonInteractiveUserSignInLogs | project TimeGenerated, UserPrincipalName, AppDisplayName | take 100'), " +
    "('AuditLogs', 'identity', 'TimeGenerated', 'Microsoft Entra ID directory audit events (who changed what).', 'AuditLogs | project TimeGenerated, OperationName, Result | take 100'), " +
    "('AzureActivity', 'platform', 'TimeGenerated', 'Azure Resource Manager subscription-level activity (control-plane) log.', 'AzureActivity | project TimeGenerated, OperationNameValue, ActivityStatusValue | take 100'), " +
    "('Heartbeat', 'infrastructure', 'TimeGenerated', 'Agent/host heartbeat pings — presence and liveness of monitored machines.', 'Heartbeat | summarize arg_max(TimeGenerated, Computer) by Computer'), " +
    "('Usage', 'operations', 'TimeGenerated', 'Per-table ingestion volume for the workspace (billing and quota).', 'Usage | summarize IngestedGB = sum(Quantity) / 1000 by DataType'), " +
    "('AzureDiagnostics', 'platform', 'TimeGenerated', 'Resource diagnostic logs routed to the workspace (multi-resource, schema varies by ResourceProvider).', 'AzureDiagnostics | project TimeGenerated, ResourceProvider, Category | take 100')" +
    ") AS t(table_name, category, time_column, description, sample_kql)",
  comment:
    "A curated, credential-free registry of common Azure Monitor / Log Analytics tables and a starter KQL for each. Browsable without an azure_graph secret; feed a table's sample_kql to loganalytics_query.",
  columnComments: {
    table_name: "The Log Analytics table name to reference at the start of a KQL query.",
    category: "A coarse grouping (identity, platform, infrastructure, operations) for navigation.",
    time_column: "The datetime column to project for incremental (watermark) pulls — TimeGenerated for these tables.",
    description: "A one-line description of what the table records.",
    sample_kql: "A ready-to-run starter KQL string to pass as loganalytics_query's kql argument.",
  },
  tags: {
    "vgi.title": "Log Analytics Table Index",
    "vgi.category": "log-analytics-query",
    domain: "observability",
    "vgi.doc_llm":
      "A static, credential-free catalog of the Azure Monitor / Log Analytics tables this worker most " +
      "commonly targets: one row per table giving its category, the datetime column to project for " +
      "watermarking (TimeGenerated), a short description, and a ready-to-run starter KQL string. Query it " +
      "to discover the workspace's queryable surface and a good opening KQL before attaching an " +
      "azure_graph secret, then pass a row's sample_kql (optionally edited) to loganalytics_query.",
    "vgi.doc_md":
      "## loganalytics_tables\n\n" +
      "A browsable, credential-free index of common Log Analytics tables (SigninLogs, AuditLogs, " +
      "AzureActivity, Heartbeat, Usage, and more). Each row names the table, its category, the " +
      "`TimeGenerated` watermark column, a one-line description, and a starter KQL. Start here to pick a " +
      "table and a query, then call `loganalytics_query` (with an `azure_graph` secret attached) to run it " +
      "against a workspace.",
    "vgi.keywords": JSON.stringify([
      "log analytics",
      "tables",
      "catalog",
      "discovery",
      "kql",
      "signinlogs",
      "auditlogs",
      "azureactivity",
      "registry",
    ]),
    "vgi.example_queries": JSON.stringify([
      {
        description: "List every curated table and its category",
        sql: "SELECT table_name, category FROM azure.main.loganalytics_tables ORDER BY category, table_name",
      },
      {
        description: "Get the starter KQL for the identity tables",
        sql: "SELECT table_name, sample_kql FROM azure.main.loganalytics_tables WHERE category = 'identity' ORDER BY table_name",
      },
    ]),
  },
};

export function makeCatalog(functions: VgiFunction[]): CatalogDescriptor {
  return {
    name: "azure",
    defaultSchema: "main",
    comment: "Azure Monitor / Log Analytics KQL passthrough (loganalytics_query) — vgi-azure-loganalytics",
    sourceUrl: REPO,
    tags: CATALOG_TAGS,
    secretTypes: [AZURE_GRAPH_SECRET],
    schemas: [
      {
        name: "main",
        comment: "Azure Monitor / Log Analytics KQL passthrough query surface (loganalytics_query).",
        tags: SCHEMA_TAGS,
        views: [LOGANALYTICS_TABLES_VIEW],
        functions,
      },
    ],
  };
}
