/**
 * La base EMBARQUÉE de la sandbox (scripts/lib/pglite-server.mjs) : un vrai serveur Postgres (TCP, protocole v3)
 * au-dessus d'une seule instance PGlite, sûr pour plusieurs clients. Le multiplexeur de @electric-sql/pglite-socket
 * entremêle les requêtes paramétrées de deux clients sur l'unique session (« bind message supplies 1 parameters,
 * but prepared statement "" requires 0 ») ; ici chaque séquence étendue et chaque transaction gardent la main.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import postgres from "postgres"
import { PGlite } from "@electric-sql/pglite"
import { startPgliteServer } from "../../scripts/lib/pglite-server.mjs"

test("3 clients concurrents (requêtes paramétrées + transactions) : 0 erreur, 0 résultat mélangé", { timeout: 90_000 }, async () => {
  const db = await PGlite.create()
  const srv = await startPgliteServer({ db })
  const mk = () => postgres(srv.url, { ssl: false, max: 1, prepare: false, onnotice: () => {} })
  const a = mk(), b = mk(), c = mk()
  try {
    await a`CREATE TABLE t (id int PRIMARY KEY, v text)`
    let errors = 0, wrong = 0
    const work = async (cl: ReturnType<typeof mk>, base: number) => {
      for (let i = 0; i < 120; i++) {
        try {
          const id = base + i
          await cl`INSERT INTO t VALUES (${id}, ${"v" + id})`
          const r = await cl`SELECT v FROM t WHERE id = ${id}`
          if (r[0]?.v !== "v" + id) wrong++
        } catch { errors++ }
      }
    }
    const tx = async (cl: ReturnType<typeof mk>) => {
      for (let i = 0; i < 30; i++) {
        try { await cl.begin(async (s) => { const r = await s`SELECT count(*)::int AS n FROM t`; await s`INSERT INTO t VALUES (${100000 + i}, ${String(r[0].n)})` }) } catch { errors++ }
      }
    }
    await Promise.all([work(a, 0), work(b, 10000), tx(c)])
    assert.equal(errors, 0)
    assert.equal(wrong, 0)
    assert.equal((await a`SELECT count(*)::int AS n FROM t`)[0].n, 270)
  } finally {
    await Promise.all([a.end({ timeout: 1 }), b.end({ timeout: 1 }), c.end({ timeout: 1 })])
    await srv.stop()
    await db.close()
  }
})

test("une connexion qui tombe au milieu d'une transaction est annulée et ne bloque pas les autres", { timeout: 60_000 }, async () => {
  const db = await PGlite.create()
  const srv = await startPgliteServer({ db })
  const a = postgres(srv.url, { ssl: false, max: 1, prepare: false, onnotice: () => {} })
  const b = postgres(srv.url, { ssl: false, max: 1, prepare: false, onnotice: () => {} })
  try {
    await a`CREATE TABLE k (id int)`
    // a ouvre une transaction, écrit, puis sa connexion est coupée net
    const reserved = await a.reserve()
    await reserved`BEGIN`
    await reserved`INSERT INTO k VALUES (1)`
    reserved.release()
    await a.end({ timeout: 0 })
    // b obtient la main, et la ligne non commitée de a n'existe pas
    const n = await Promise.race([b`SELECT count(*)::int AS n FROM k`, new Promise((_, rej) => setTimeout(() => rej(new Error("bloqué")), 10_000))]) as any
    assert.equal(n[0].n, 0)
  } finally {
    await b.end({ timeout: 1 })
    await srv.stop()
    await db.close()
  }
})
