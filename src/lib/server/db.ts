// Postgres for the server. In production through Cloudflare Hyperdrive (binding HYPERDRIVE,
// caching off); in `npm run dev` through DATABASE_URL in .dev.vars (the local Supabase stack).
// This connection bypasses row level security, so every query here checks ownership itself.
//
// Workers must not share a connection between requests: each call opens a client, runs, and
// closes it (Hyperdrive keeps the real connections pooled, so this is cheap).

import { getCloudflareContext } from "@opennextjs/cloudflare";
import postgres from "postgres";

export type Sql = postgres.Sql;

export class DbNotConfiguredError extends Error {
  constructor() {
    super("No database: add DATABASE_URL to .dev.vars locally, or the HYPERDRIVE binding in wrangler.jsonc.");
  }
}

function connectionString() {
  // HYPERDRIVE joins wrangler.jsonc once the production database exists.
  const env = getCloudflareContext().env as CloudflareEnv & { HYPERDRIVE?: { connectionString: string } };
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) throw new DbNotConfiguredError();
  return url;
}

export async function withDb<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = postgres(connectionString(), { max: 1, fetch_types: false, idle_timeout: 5 });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 2 });
  }
}
