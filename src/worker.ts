// vgi-azure-loganalytics stdio worker entry. DuckDB spawns this and ATTACHes it:
//   ATTACH 'la' AS la (TYPE vgi, LOCATION '/path/to/worker.ts');
//   CREATE SECRET g (TYPE azure_graph, TENANT_ID '…', CLIENT_ID '…', CLIENT_SECRET '…');
//   -- full pull over the last day:
//   SELECT * FROM la.loganalytics_query(kql := 'AuditLogs | take 100', workspace := '<guid>');
//   -- incremental (project TimeGenerated for the watermark to exist):
//   SELECT * FROM la.loganalytics_query(kql := 'SigninLogs | project TimeGenerated, UserPrincipalName',
//                                       workspace := '<guid>', since := '<prior _watermark_next>');
//
// The ONE thing that differs from vgi-azure-directory: audience is "loganalytics"
// (api.loganalytics.io/.default), NOT "graph". A graph.microsoft.com token is rejected
// by the query plane; the (tenant, client, audience) cache key keeps them distinct.

import { Worker, ReadOnlyCatalogInterface, FunctionRegistry } from "@query-farm/vgi";
import { TokenCache, makeGraphClient, type Fetch } from "@vgi-azure/graph-core";
import { makeMsalMinter } from "@vgi-azure/node-auth";
import { makeQueryFunction } from "./functions.js";
import { makeCatalog } from "./catalog.js";

const cache = new TokenCache(makeMsalMinter());

const clientFactory = (secret: Record<string, unknown>) =>
  makeGraphClient({
    fetch: globalThis.fetch as unknown as Fetch,
    cache,
    cred: {
      tenantId: String(secret.tenant_id ?? ""),
      clientId: String(secret.client_id ?? ""),
      clientSecret: secret.client_secret != null ? String(secret.client_secret) : undefined,
    },
    audience: "loganalytics",
  });

const functions = [makeQueryFunction(clientFactory)];

const registry = new FunctionRegistry();
for (const f of functions) registry.register(f);

const catalogInterface = new ReadOnlyCatalogInterface(makeCatalog(functions), registry);

new Worker({ functions, catalogInterface }).run();
