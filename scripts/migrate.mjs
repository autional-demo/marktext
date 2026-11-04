#!/usr/bin/env node
/**
 * 执行 db/schema.sql。
 *
 * 用法：
 *   node --env-file=.env.local scripts/migrate.mjs
 *
 * 走 Neon 的 HTTP 驱动，不需要安装 psql。
 */
import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 未设置。用 --env-file=.env.local 运行。");
  process.exit(1);
}

const schemaPath = new URL("../db/schema.sql", import.meta.url);
const source = await readFile(schemaPath, "utf8");

// schema.sql 里没有函数体/字符串内的分号，按 ";\n" 切分即可。
const statements = source
  .split(/;\s*(?:\r?\n|$)/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const sql = neon(url);

for (const statement of statements) {
  await sql.query(statement);
  const firstLine =
    statement
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("--")) ?? "";
  console.log(`ok  ${firstLine.slice(0, 70)}`);
}

const rows = await sql`
  select table_name
  from information_schema.tables
  where table_schema = 'public'
  order by table_name
`;

console.log(`\ntables: ${rows.map((r) => r.table_name).join(", ") || "(none)"}`);

const cols = await sql`
  select column_name, data_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'documents'
  order by ordinal_position
`;

console.log(`documents: ${cols.map((c) => `${c.column_name}:${c.data_type}`).join(", ")}`);
