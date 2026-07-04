// The `azure` catalog descriptor + the azure_graph secret type. The secret shape is
// the SAME frozen app-only client-credentials type directory owns (§7): tenant_id,
// client_id, client_secret[redact]. Only the token AUDIENCE differs (loganalytics),
// and that is set in worker.ts's clientFactory, not here.

import { Schema, Field, Utf8 } from "@query-farm/apache-arrow";
import type { CatalogDescriptor, SecretTypeDescriptor, VgiFunction } from "@query-farm/vgi";

export const AZURE_GRAPH_SECRET: SecretTypeDescriptor = {
  name: "azure_graph",
  description: "Microsoft Entra app-only (client-credentials) credentials for Azure Monitor / Log Analytics",
  schema: new Schema([
    new Field("tenant_id", new Utf8(), true),
    new Field("client_id", new Utf8(), true),
    new Field("client_secret", new Utf8(), true, new Map([["redact", "true"]])),
  ]),
};

export function makeCatalog(functions: VgiFunction[]): CatalogDescriptor {
  return {
    name: "azure",
    defaultSchema: "main",
    comment: "Azure Monitor / Log Analytics KQL passthrough (loganalytics_query) — vgi-azure-loganalytics",
    sourceUrl: "https://query.farm",
    secretTypes: [AZURE_GRAPH_SECRET],
    schemas: [{ name: "main", functions }],
  };
}
