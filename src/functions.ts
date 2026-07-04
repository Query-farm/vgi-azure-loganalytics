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
