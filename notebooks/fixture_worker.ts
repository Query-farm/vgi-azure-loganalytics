/** Wire unchanged remote exports to their existing testable client seam.
 * The worker still sends KQL, decodes the Kusto envelope and emits Arrow rows.
 * The adapter routes only query POSTs to loopback; no authentication/live calls.
 */
import { FunctionRegistry, ReadOnlyCatalogInterface, Worker } from "@query-farm/vgi";
import { makeQueryFunction } from "./src/functions.ts";
import { makeCatalog } from "./src/catalog.ts";

const rawBase = process.env.NOTEBOOK_LOGANALYTICS_FIXTURE_URL;
if (!rawBase) throw new Error("Start the notebook's local fixture first");
const base = new URL(rawBase);
if (base.protocol !== "http:" || base.hostname !== "127.0.0.1") {
  throw new Error("This adapter accepts only an HTTP loopback fixture");
}
const clientFactory = () => ({
  fetchJson: async () => { throw new Error("Only query POSTs are supported"); },
  postJson: async (url: string, body: unknown): Promise<Record<string, unknown>> => {
    const original = new URL(url);
    if (original.origin !== "https://api.loganalytics.io") {
      throw new Error("Unexpected query origin in the pinned worker");
    }
    const response = await fetch(new URL(original.pathname + original.search, base), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Synthetic fixture: ${response.status} ${await response.text()}`);
    return await response.json() as Record<string, unknown>;
  },
});
const functions = [makeQueryFunction(clientFactory)];
const registry = new FunctionRegistry();
for (const fn of functions) registry.register(fn);
new Worker({ functions, catalogInterface: new ReadOnlyCatalogInterface(makeCatalog(functions), registry) }).run();
