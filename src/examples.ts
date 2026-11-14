// Composed example queries: each combines loganalytics_query (live KQL) with the
// credential-free loganalytics_tables index in one query. Defined once here and
// referenced from the schema-level vgi.example_queries (catalog.ts) and from the
// example list of the object that drives each query (functions.ts / the view).
//
// Both join on the KQL output rather than feeding sample_kql into the function: a
// table function's `kql` must be a literal, so DuckDB rejects LATERAL column
// references and scalar subqueries as its arguments.

export interface ExampleQuery {
  description: string;
  sql: string;
}

/** Driven by loganalytics_query: last-day ingestion per table, labelled from the index. */
export const INGESTION_BY_TABLE_EXAMPLE: ExampleQuery = {
  description:
    "Last-day ingested GB per table from the Usage table, joined to loganalytics_tables for each table's category (NULL for tables outside the curated index), largest first",
  sql:
    "SELECT u.result->>'DataType' AS table_name, t.category, CAST(u.result->>'IngestedGB' AS DOUBLE) AS ingested_gb " +
    "FROM azure.main.loganalytics_query('Usage | summarize IngestedGB = sum(Quantity) / 1000 by DataType', '<workspace-guid>') u " +
    "LEFT JOIN azure.main.loganalytics_tables t ON t.table_name = u.result->>'DataType' " +
    "WHERE u._row_kind IS NULL ORDER BY ingested_gb DESC, table_name",
};

/** Driven by loganalytics_tables: curated tables with no ingestion recorded in Usage. */
export const SILENT_TABLES_EXAMPLE: ExampleQuery = {
  description:
    "Curated tables from loganalytics_tables with no ingestion recorded in the workspace's Usage table over the last day (e.g. a diagnostic setting or agent that is not sending data)",
  sql:
    "SELECT t.table_name, t.category FROM azure.main.loganalytics_tables t " +
    "WHERE NOT EXISTS (SELECT 1 FROM azure.main.loganalytics_query('Usage | summarize IngestedGB = sum(Quantity) / 1000 by DataType', '<workspace-guid>') u " +
    "WHERE u._row_kind IS NULL AND u.result->>'DataType' = t.table_name) " +
    "ORDER BY t.category, t.table_name",
};
