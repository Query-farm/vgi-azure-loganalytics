# Log Analytics ingestion notebooks

[01 · Measure ingestion without hiding coverage gaps](01_ingestion_and_coverage.ipynb)
sends a literal KQL projection through the real worker, types its JSON in SQL, and
joins observations to the worker's curated table index. Two figures compare daily
volumes and known table subtotals. All observations are synthetic, with explicit
missing quantity, unsupported units, measured zero and absent-table coverage.

## Install and run

Install [uv](https://docs.astral.sh/uv/), [Bun](https://bun.sh/) and Git. Validation
used Bun **1.3.14**. This directory can be copied away from the worker repository;
it needs no parent source tree or root Python environment. From here:

```sh
uv sync --locked
uv run --locked python execute.py --timeout 300
```

The separate lock pins Haybarn **2.0.0rc11**, JupySQL, plotting and execution tools.
The runner uses a temporary kernel with its interpreter and this directory as cwd.
It atomically replaces a notebook after success; parameter overrides require a
separate destination. For an existing Jupyter frontend:

```sh
uv run --locked python -m ipykernel install --user \
  --name vgi-azure-loganalytics-notebooks --display-name "Python (vgi-azure-loganalytics notebooks)"
```

Select that kernel and **Restart Kernel → Run All** after editing parameters.
The runner does not register a global kernel. First runs require downloads.

## Portable worker connections

The visible native connection uses the literal location
`github-auto://Query-farm/vgi-azure-loganalytics@v0.4.0` for credential-free
`loganalytics_tables` discovery. This is a curated documentation index, not an
inventory of enabled or installed tables in a workspace.

The analytical connection uses `bash launch_fixture.sh`. The launcher clones
public remote revision **9b7c851b11599935a5acedcebd77180c82092548** into ignored
`artifacts/`, verifies the revision and unchanged source, and installs that
revision's committed lock with `bun install --frozen-lockfile`. It pins SDK
`@query-farm/vgi 0.50.0`, RPC 0.29.7 and Arrow 21.1.1. This revision adds composed
metadata examples after v0.4.0; the query driver is unchanged. No local worker
build or source discovery outside this directory is required.

`fixture_worker.ts` registers unchanged `makeQueryFunction` and `makeCatalog`
exports through the real VGI SDK. Their existing client-factory seam supplies an
HTTP adapter that accepts only the expected Log Analytics origin and maps the
query POST to loopback. The worker builds the POST body, maps the Kusto columns
and rows to JSON, and emits its real Arrow schema. The adapter does not authenticate
or forward requests to Microsoft. The SQL secret is a public dummy string.

Native query retrieval, Microsoft Entra authentication, permissions, retries,
query limits, incremental watermarks and real Azure workspace behavior are outside
this example. No private data, real credentials, paid queries or remote writes
are involved. A local POST here is a read-only query of synthetic observations.

## Focused experiment

```sh
uv run --locked python execute.py --timeout 300 \
  --parameters '{"WINDOW_DAYS": 3}' --output-dir artifacts/three-days
```

The default is **7**; accepted integers are **1–7**. The fixed window ends at
**25 June 2026, 00:00 UTC, exclusive** and starts that many days earlier, inclusive.
Predict that removing the early platform spike changes the leading table. Compare
the leading known subtotal and share, daily chart and exclusion counts. This is a
fixed historical synthetic window, not a current live query or forecast. Reset to
**7** for the default.

Experiment copies include this guide, runner, launcher, fixture, helper, lock and
branding assets. Generated logs, source caches, figures and experiments are ignored.

## Fixture and measurement semantics

`synthetic_loganalytics_api.py` serves one loopback query endpoint. Its Kusto
`tables/columns/rows` envelope follows `test/fake-loganalytics.ts` from the pinned
MIT source (Query Farm). It accepts exactly the visible KQL projection and a UTC
interval inside **18–25 June 2026**. The fixture is not a KQL engine; it returns
projected, invented rows filtered to the requested half-open window. Unsupported
queries/endpoints fail explicitly, with no live fallback. The request trace checks
that the worker preserves the KQL and timespan and makes one materialized query.

`MBytes` means decimal MB for these synthetic quantities: 1 MB = 1,000,000 bytes,
1 GB = 1,000 MB. These observed quantities are not a bill or price estimate.
The fixture has an early AzureDiagnostics spike, later SigninLogs growth, steady
other observations, an explicit zero-valued AzureActivity measurement each day,
one missing AzureDiagnostics quantity, and one Unmapped_CL value in unsupported
`packets`. No AADNonInteractiveUserSignInLogs observations are present.

SQL preserves raw JSON and categorizes exclusions before aggregation. Unknown or
incompatible measurements never become zeros. A known subtotal can still have
excluded rows; it is then a partial measurement. The full join keeps custom names
as Unlisted and indexed names with no observations as not observed. `Usage` itself
is excluded from the index comparison because it is the measurement source.
Absence in this response says nothing conclusive about collection health, workspace
configuration or actual zero ingestion.

The snapshot supplies no `since` cursor and has no marker. All data stays in memory.
Large live results require caller-managed slicing; this small example does not test
service truncation, KQL execution, durability or incremental replay.

## Validation and upgrades

The source suite passes **12 Bun tests, 31 expectations**, and own-source
TypeScript checking. The CI-prescribed vgi-lint 2.5.1 metadata check reports
**100/100, L1 structural assurance, zero findings**; it deliberately does not run
credentialed examples. Notebook execution separately verifies seven SQL
relationships, daily/table reconciliation and the local HTTP request contract.

To upgrade, change the explicit release/revision pins, inspect the remote lock,
rerun both parameter sets and review the figures before replacing successful
outputs. The community VGI extension is downloaded independently of the Python lock.
The unchanged local Strata Sun and VGI marks link to Query.Farm and VGI.

## SQL credential isolation

The notebook creates Haybarn with a fresh temporary `secret_directory` and
`allow_persistent_secrets=False` before attaching workers. It fully drains and
checks an empty secret inventory, then creates only explicitly `TEMPORARY`
public fixture secrets and verifies their `persistent=false`, `storage=memory`
metadata. Cleanup removes the temporary directory after closing the connection.
Existing user SQL secrets are neither read, modified nor deleted.
