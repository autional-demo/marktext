import { neon } from "@neondatabase/serverless";

type Sql = ReturnType<typeof neon>;

let client: Sql | null = null;

/**
 * 懒加载数据库连接。
 * 不在模块顶层读取 DATABASE_URL —— 构建阶段也会加载路由模块，
 * 顶层抛错会让 `next build` 失败。
 */
export function db(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL 未配置（服务端环境变量）");
  }
  if (!client) client = neon(url);
  return client;
}
