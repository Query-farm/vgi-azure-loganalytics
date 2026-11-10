# vgi-azure-loganalytics

A [VGI](https://query.farm) worker (**Azure Monitor Log Analytics**) for DuckDB. KQL passthrough to an Azure Monitor / Log Analytics workspace as one DuckDB table function, `loganalytics_query(kql, workspace)`. The KQL text is sent verbatim and each Kusto result row comes back as one JSON `result` string. A plain call pulls a `timespan` window (an ISO-8601 duration, default `P1D`); for incremental pulls, project `TimeGenerated` in the KQL and pass `since := '<prior _watermark_next>'`, and the function adds a marker row (`_row_kind = 'marker'`) whose `_watermark_next` is the cursor to persist. Very large result sets (over roughly 500k rows / 64 MB) must be time-sliced by the caller. A credential-free `loganalytics_tables` view lists queryable tables with sample KQL.

## Quick start

Every [GitHub release](https://github.com/Query-farm/vgi-azure-loganalytics/releases) ships a prebuilt worker binary. The `vgi` extension downloads the one for your platform, checks its SHA-256 and caches it, so there is nothing to install besides DuckDB:

```sql
INSTALL vgi FROM community;
LOAD vgi;

ATTACH 'azure' AS azure (TYPE vgi, LOCATION 'github-auto://Query-farm/vgi-azure-loganalytics@v0.3.0');

-- Bind loganalytics_query and expose its result columns (credential-free; drop LIMIT 0
-- and attach an azure_graph secret to run the KQL against a real workspace)
SELECT result, _row_kind, _watermark_next FROM azure.main.loganalytics_query('AzureActivity | take 1', '00000000-0000-0000-0000-000000000000') LIMIT 0;

-- Snapshot: the 100 most recent audit-log entries over the last day
SELECT result FROM azure.main.loganalytics_query('AuditLogs | take 100', '<workspace-guid>') WHERE _row_kind IS NULL;
```

The first example is a credential-free `LIMIT 0` bind probe: it checks that `loganalytics_query` binds and shows its result columns without calling Azure. The second returns real rows, so it needs an `azure_graph` secret (see [Credentials](#credentials)) and your workspace GUID in place of `<workspace-guid>`.

All the Query Farm Azure workers use the catalog name `azure`. To attach more than one in the same session, give each its own alias (for example `ATTACH 'azure' AS azure_loganalytics (...)`) and qualify queries with that alias instead of `azure`.

Prebuilt binaries cover macOS (Apple silicon), Linux (x86-64 and arm64). `github-auto://` needs an explicit release tag; change `@v0.3.0` to move to a newer release.

### Other ways to run it

- **Docker** (the image bundles the worker; needs a container runtime):

  ```sql
  ATTACH 'azure' AS azure (TYPE vgi, LOCATION 'docker://ghcr.io/query-farm/vgi-azure-loganalytics:0.3.0');
  ```

- **Manual download.** Download the archive for your platform from the [releases page](https://github.com/Query-farm/vgi-azure-loganalytics/releases), verify it against its `.sha256` file (a cosign `.cosign.bundle` is published alongside), unpack it, and set `LOCATION` to the path of the extracted worker executable.

### Build from source

To build and test the worker yourself, see [Development](#development).

## Credentials

Live queries authenticate with an `azure_graph` secret holding app-only Microsoft Entra client credentials for a service principal: `TENANT_ID`, `CLIENT_ID` and `CLIENT_SECRET` (the client secret is redacted when secrets are listed). The worker registers the `azure_graph` secret type when it is attached, so create the secret after the `ATTACH`:

```sql
ATTACH 'azure' AS azure (TYPE vgi, LOCATION 'github-auto://Query-farm/vgi-azure-loganalytics@v0.3.0');
CREATE SECRET azure_sp (TYPE azure_graph, TENANT_ID '<tenant-guid>', CLIENT_ID '<app-guid>', CLIENT_SECRET '<secret>');
```

For this worker the service principal needs read access to the target Log Analytics workspace (tokens are minted for the `api.loganalytics.io` audience).

## Development

Requires [Bun](https://bun.sh). `bun install` also fetches the shared `@vgi-azure/graph-core` package from GitHub.

```bash
bun install && bun test
bun run typecheck
```

To attach a local checkout, point `LOCATION` at the launch wrapper:

```sql
ATTACH 'azure' AS azure (TYPE vgi, LOCATION '/path/to/vgi-azure-loganalytics/bin/vgi-azure-loganalytics-worker');
```

## License

MIT. See [LICENSE](LICENSE).
