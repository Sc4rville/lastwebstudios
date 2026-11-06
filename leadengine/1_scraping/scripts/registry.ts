/**
 * Scraping — le REGISTRE de dédup (partagé entre opérateurs, versionné).
 *
 * Mémorise chaque domaine déjà vu (seeds + runs précédents) ET chaque clé stable (ex. siren) déjà
 * tentée, pour que :
 *   - un re-run n'ajoute QUE du neuf dans data/raw/prospects.scraped.csv ;
 *   - on ne re-tente pas un enrichissement (cher) sur une boîte déjà essayée sans succès.
 *
 * Fichier : data/raw/prospects.registry.json (versionné — cf. .gitignore).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { domainOf, csvJoin, csvSplit, type Found } from "./util.ts"

const RAW = join("data", "raw")
const REGISTRY = join(RAW, "prospects.registry.json")
export const SCRAPED = join(RAW, "prospects.scraped.csv")

// CSV existants comptés comme « déjà vus » (jamais re-proposés)
const SEEDS = ["cuisinistes.seed.csv", "prospects.seed.csv", "prospects.batch2.csv", "prospects.scraped.csv"]

type Entry = { name: string; industry: string; source: string; firstSeen: string }
type RegistryFile = { domains: Record<string, Entry>; keys: Record<string, string> }

export class Registry {
  private domains: Record<string, Entry> = {}
  private keys: Record<string, string> = {} // clé stable (ex. "sirene:<siren>") → date de tentative

  static async load(): Promise<Registry> {
    const r = new Registry()
    const raw: Partial<RegistryFile> = await readFile(REGISTRY, "utf8").then(JSON.parse, () => ({}))
    // rétro-compat : ancien format = map plate domaine→entry
    if (raw && !("domains" in raw) && typeof raw === "object") {
      r.domains = raw as Record<string, Entry>
    } else {
      r.domains = raw.domains ?? {}
      r.keys = raw.keys ?? {}
    }
    for (const f of SEEDS) {
      const text = await readFile(join(RAW, f), "utf8").catch(() => "")
      for (const line of text.split("\n").slice(1)) {
        const [name, , website] = csvSplit(line)
        const d = domainOf(website?.trim() ?? "")
        if (d && !r.domains[d]) r.domains[d] = { name: name?.trim() ?? "", industry: "", source: f, firstSeen: "" }
      }
    }
    return r
  }

  hasDomain(d: string) { return !!d && d in this.domains }
  hasKey(k: string) { return !!k && k in this.keys }

  // marque une clé stable comme tentée (qu'elle ait abouti ou non) → pas de re-tentative coûteuse
  markTried(key: string, date: string) { if (key) this.keys[key] = date }

  // enregistre un prospect retenu (avec site) ; renvoie false si domaine déjà connu
  add(f: Found, date: string): boolean {
    const d = domainOf(f.website)
    if (!d || this.hasDomain(d)) return false
    this.domains[d] = { name: f.name, industry: f.industry, source: f.source, firstSeen: date }
    return true
  }

  async save() {
    await mkdir(RAW, { recursive: true })
    const out: RegistryFile = { domains: this.domains, keys: this.keys }
    await writeFile(REGISTRY, JSON.stringify(out, null, 2))
  }
}

// schéma canonique du CSV (le pipeline lit par NOM de colonne → ajouter `email` ne casse rien)
const HEADER = "name,city,website,phone,industry,email"
const row = (f: Found) => csvJoin([f.name, f.city, f.website, f.phone, f.industry, f.email ?? ""])

// ajoute des lignes ; migre l'en-tête vers le schéma canonique au passage (anciens fichiers 5 colonnes)
export async function appendCsv(rows: Found[]) {
  if (!rows.length) return
  await mkdir(RAW, { recursive: true })
  const existing = (await readFile(SCRAPED, "utf8").catch(() => "")).split("\n").filter(Boolean)
  const oldData = existing.length > 1 ? existing.slice(1).map((l) => (csvSplit(l).length >= 6 ? l : l + ",")) : []
  await writeFile(SCRAPED, [HEADER, ...oldData, ...rows.map(row)].join("\n") + "\n")
}
