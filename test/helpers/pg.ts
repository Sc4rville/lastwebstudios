/**
 * pg.ts · a FRESH Postgres database per test file, in the throwaway Postgres of `npm run test:pg`
 * (DATABASE_URL set by test/run.mjs, always on 127.0.0.1). Dropped at the end.
 */
import postgres from "postgres"
import { randomBytes } from "node:crypto"
import { assertTestEnv } from "./workspace.ts"

export async function freshDatabase(): Promise<{ url: string; sql: ReturnType<typeof postgres>; drop: () => Promise<void> }> {
  assertTestEnv()
  const admin = process.env.DATABASE_URL
  if (!admin) throw new Error("DATABASE_URL is missing: run `npm run test:pg`")
  const name = `lws_t_${randomBytes(5).toString("hex")}`
  const a = postgres(admin, { ssl: false, max: 1, onnotice: () => {} })
  await a.unsafe(`CREATE DATABASE ${name}`)
  await a.end()
  const u = new URL(admin); u.pathname = `/${name}`
  const url = u.toString()
  const sql = postgres(url, { ssl: false, max: 2, onnotice: () => {}, types: { int8: { to: 20, from: [20], serialize: (x: number) => "" + x, parse: (x: string) => parseInt(x, 10) } } as any })
  return {
    url, sql,
    drop: async () => {
      await sql.end({ timeout: 2 })
      const b = postgres(admin, { ssl: false, max: 1, onnotice: () => {} })
      try { await b.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`) } finally { await b.end() }
    },
  }
}
