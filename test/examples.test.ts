// Composed examples (src/examples.ts) must appear in the schema-level list AND within
// the first five examples of the object that drives each query (the agent simulator
// only shows an object's first five), and every example must stay catalog-qualified.

import { test, expect } from "bun:test";
import { makeCatalog } from "../src/catalog.js";
import { makeQueryFunction } from "../src/functions.js";
import { INGESTION_BY_TABLE_EXAMPLE, SILENT_TABLES_EXAMPLE, type ExampleQuery } from "../src/examples.js";

const fn = makeQueryFunction(() => {
  throw new Error("no client in metadata tests");
});
const schema = makeCatalog([fn]).schemas[0]!;
const parse = (tags: Record<string, string> | undefined): ExampleQuery[] =>
  JSON.parse(tags?.["vgi.example_queries"] ?? "[]");
const sqls = (xs: ExampleQuery[]) => xs.map((x) => x.sql);

test("composed examples are on the schema-level list", () => {
  const schemaSql = sqls(parse(schema.tags));
  expect(schemaSql).toContain(INGESTION_BY_TABLE_EXAMPLE.sql);
  expect(schemaSql).toContain(SILENT_TABLES_EXAMPLE.sql);
});

test("each composed example is in its driving object's first five examples", () => {
  const fnTags = (fn as unknown as { meta: { tags?: Record<string, string> } }).meta.tags;
  expect(sqls(parse(fnTags)).slice(0, 5)).toContain(INGESTION_BY_TABLE_EXAMPLE.sql);
  const view = schema.views!.find((v) => v.name === "loganalytics_tables")!;
  expect(sqls(parse(view.tags)).slice(0, 5)).toContain(SILENT_TABLES_EXAMPLE.sql);
});

test("composed examples reference both worker objects, catalog-qualified", () => {
  for (const ex of [INGESTION_BY_TABLE_EXAMPLE, SILENT_TABLES_EXAMPLE]) {
    expect(ex.description.length).toBeGreaterThan(0);
    expect(ex.sql).toContain("azure.main.loganalytics_query(");
    expect(ex.sql).toContain("azure.main.loganalytics_tables");
    expect(ex.sql).toContain("ORDER BY");
  }
});
