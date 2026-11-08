/**
 * lines.mjs · reading a child process's output WITHOUT breaking it.
 *
 * A pipe delivers PIECES of bytes (up to 64 KB on Linux) that respect neither characters nor lines:
 *   · `chunk.toString()` piece by piece cuts a UTF-8 character that straddles two pieces ("é" = 2 bytes) → "��" in
 *     a sheet, an email, a log: French content (and any non-ASCII text) hits it as soon as an output is long;
 *   · `chunk.toString().split("\n")` cuts a straddling JSON line into two unreadable halves → the `result`
 *     event of `claude -p --output-format stream-json` (cost, tokens) is lost, and the cage's spend ledger
 *     with it (found by the blitz test of 24/10, FAKE_CLAUDE_CHUNKED).
 *
 * Here: a stateful UTF-8 decoder (node:string_decoder) + a line buffer, flushed at the end of the stream.
 * Plain JS (+ lines.d.mts): importable by TypeScript (tsx) and by the .mjs files run with `node` (coach).
 */
import { StringDecoder } from "node:string_decoder"

/**
 * Splits a stream into COMPLETE lines (without the "\n", a final "\r" removed). Call `end()` at the end of the stream
 * (the `close`/`end` event): the last line without a line break is then delivered.
 * @param {(line: string) => void} onLine
 */
export function lineSplitter(onLine) {
  const dec = new StringDecoder("utf8")
  let buf = ""
  let ended = false
  const drain = () => {
    let i
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.endsWith("\r", i) ? buf.slice(0, i - 1) : buf.slice(0, i)
      buf = buf.slice(i + 1)
      onLine(line)
    }
  }
  return {
    /** @param {Buffer | string} chunk */
    push(chunk) {
      if (ended) return
      buf += typeof chunk === "string" ? chunk : dec.write(chunk)
      drain()
    },
    end() {
      if (ended) return
      ended = true
      buf += dec.end()
      drain()
      if (buf) { const last = buf.endsWith("\r") ? buf.slice(0, -1) : buf; buf = ""; onLine(last) }
    },
  }
}

/** Accumulates a byte stream and decodes it ONCE (UTF-8 intact). `max` (bytes) bounds memory: beyond it, the end is kept. */
export function textCollector(max = Infinity) {
  /** @type {Buffer[]} */
  let chunks = []
  let size = 0
  return {
    /** @param {Buffer | string} chunk */
    push(chunk) {
      const b = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk
      chunks.push(b)
      size += b.length
      if (size > max * 2) { const all = Buffer.concat(chunks); chunks = [all.subarray(all.length - max)]; size = max }
    },
    get bytes() { return size },
    text() {
      const all = Buffer.concat(chunks)
      const kept = all.length > max ? all.subarray(all.length - max) : all
      // a cut in the middle of a character at the start of the kept window → skip the continuation bytes
      let s = 0
      if (kept !== all) while (s < kept.length && (kept[s] & 0xc0) === 0x80) s++
      return kept.subarray(s).toString("utf8")
    },
  }
}
