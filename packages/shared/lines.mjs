/**
 * lines.mjs · lire la sortie d'un process enfant SANS la casser.
 *
 * Un tube livre des MORCEAUX d'octets (jusqu'à 64 Ko sous Linux) qui ne respectent ni les caractères ni les lignes :
 *   · `chunk.toString()` morceau par morceau coupe un caractère UTF-8 à cheval (« é » = 2 octets) → « �� » dans
 *     une fiche, un mail, un journal : le produit est en français, ça arrive dès qu'une sortie est longue ;
 *   · `chunk.toString().split("\n")` coupe une ligne JSON à cheval en deux moitiés illisibles → l'évènement
 *     `result` de `claude -p --output-format stream-json` (coût, jetons) est perdu, et avec lui le registre de
 *     dépense de la cage (trouvé par le test blitz du 24/10, FAKE_CLAUDE_CHUNKED).
 *
 * Ici : un décodeur UTF-8 à état (node:string_decoder) + un tampon de ligne, vidé à la fin du flux.
 * En JS pur (+ lines.d.mts) : importable par le TypeScript (tsx) comme par les .mjs lancés avec `node` (coach).
 */
import { StringDecoder } from "node:string_decoder"

/**
 * Découpe un flux en lignes COMPLÈTES (sans le « \n », « \r » final retiré). Appeler `end()` à la fin du flux
 * (évènement `close`/`end`) : la dernière ligne sans retour à la ligne est alors livrée.
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

/** Accumule un flux d'octets et le décode UNE fois (UTF-8 intact). `max` (octets) borne la mémoire : au-delà, la fin est gardée. */
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
      // une coupe en plein caractère au début de la fenêtre gardée → on saute les octets de continuation
      let s = 0
      if (kept !== all) while (s < kept.length && (kept[s] & 0xc0) === 0x80) s++
      return kept.subarray(s).toString("utf8")
    },
  }
}
