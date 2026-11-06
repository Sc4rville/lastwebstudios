/**
 * scripts/lib/pglite-server.mjs · un vrai serveur Postgres (protocole v3, TCP) au-dessus d'UNE instance PGlite
 * (Postgres compilé en WebAssembly, en mémoire) : le cockpit, le worker, le séquenceur et les CLIs s'y connectent
 * avec leur `DATABASE_URL` et la lib `postgres` habituelle, sans Docker ni installation. Utilisé par `npm run sandbox`.
 *
 * Pourquoi pas `PGLiteSocketServer` tel quel (@electric-sql/pglite-socket) : PGlite n'a qu'UNE session, et le
 * multiplexeur du paquet ordonnance message par message. Deux clients qui envoient en même temps une requête
 * paramétrée (Parse/Bind/Execute/Sync, ce que fait postgres.js) s'entremêlent sur l'unique instruction préparée
 * anonyme : « bind message supplies 1 parameters, but prepared statement "" requires 0 », « portal "" does not
 * exist » (reproduit : 27 erreurs sur 650 requêtes concurrentes). Ici un client garde la main d'un bout à l'autre
 * d'une séquence étendue (jusqu'à son Sync) et pendant toute transaction ouverte ; les autres attendent leur tour.
 * Même trafic : 0 erreur. Une connexion qui tombe au milieu d'une transaction est annulée (ROLLBACK).
 */
import { createServer } from "node:net"

const SSL_REQUEST = 80877103, GSSENC_REQUEST = 80877104, CANCEL_REQUEST = 80877102, PROTOCOL_V3 = 196608

/**
 * @param {{ db: import("@electric-sql/pglite").PGlite, host?: string, port?: number, maxConnections?: number }} o
 * @returns {Promise<{ port: number, host: string, url: string, connections: () => number, stop: () => Promise<void> }>}
 */
export async function startPgliteServer({ db, host = "127.0.0.1", port = 0, maxConnections = 32 }) {
  await db.waitReady
  const conns = new Set()
  const waiting = [] // FIFO global : { conn, type, msg }
  let owner = null // la connexion qui détient la session (séquence étendue en cours ou transaction ouverte)
  let pumping = false

  async function pump() {
    if (pumping) return
    pumping = true
    try {
      while (waiting.length) {
        const i = owner ? waiting.findIndex((w) => w.conn === owner) : 0
        if (i < 0) break // le détenteur n'a pas encore envoyé la suite de sa séquence : les autres attendent
        const w = waiting.splice(i, 1)[0]
        if (w.type === "rollback") { // le détenteur est parti au milieu d'une transaction : on l'annule
          try { if (db.isInTransaction()) await db.exec("ROLLBACK") } catch { /* déjà annulée */ }
          owner = null
          continue
        }
        if (w.conn.closed) continue
        try {
          await db.runExclusive(() => db.execProtocolRawStream(w.msg, { onRawData: (d) => { if (!w.conn.closed && d.length) w.conn.socket.write(Buffer.from(d)) } }))
        } catch (e) {
          w.conn.socket.destroy(e instanceof Error ? e : new Error(String(e)))
        }
        if (db.isInTransaction()) owner = w.conn
        else owner = w.type === "S" || w.type === "Q" || w.type === "startup" || w.type === "F" ? null : w.conn
      }
    } finally { pumping = false }
  }

  // passe par la file (jamais en parallèle d'un message en cours) ; exec() prend lui-même le verrou de PGlite
  function release(conn) {
    for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].conn === conn) waiting.splice(i, 1)
    if (owner === conn) waiting.unshift({ conn, type: "rollback", msg: null })
    pump()
  }

  const server = createServer((socket) => {
    if (conns.size >= maxConnections) { socket.end(); return }
    socket.setNoDelay(true)
    const conn = { socket, closed: false, started: false, buf: Buffer.alloc(0) }
    conns.add(conn)
    socket.on("data", (chunk) => {
      conn.buf = conn.buf.length ? Buffer.concat([conn.buf, chunk]) : chunk
      for (;;) {
        const b = conn.buf
        if (!conn.started) {
          if (b.length < 8) break
          const len = b.readInt32BE(0), code = b.readInt32BE(4)
          if (b.length < len) break
          conn.buf = b.subarray(len)
          if (code === SSL_REQUEST || code === GSSENC_REQUEST) { socket.write("N"); continue }
          if (code === CANCEL_REQUEST) { socket.end(); break }
          if (code !== PROTOCOL_V3) { socket.destroy(); break }
          conn.started = true
          waiting.push({ conn, type: "startup", msg: new Uint8Array(b.subarray(0, len)) })
          continue
        }
        if (b.length < 5) break
        const total = 1 + b.readInt32BE(1)
        if (b.length < total) break
        const type = String.fromCharCode(b[0])
        conn.buf = b.subarray(total)
        if (type === "X") { socket.end(); break } // Terminate : rien à exécuter
        waiting.push({ conn, type, msg: new Uint8Array(b.subarray(0, total)) })
      }
      pump()
    })
    const bye = () => { if (conn.closed) return; conn.closed = true; conns.delete(conn); release(conn) }
    socket.on("close", bye)
    socket.on("error", bye)
  })
  await new Promise((res, rej) => { server.once("error", rej); server.listen(port, host, res) })
  const actual = server.address().port
  return {
    port: actual, host,
    url: `postgres://postgres:postgres@${host}:${actual}/postgres`,
    connections: () => conns.size,
    stop: () => new Promise((res) => { for (const c of conns) c.socket.destroy(); server.close(() => res()) }),
  }
}
