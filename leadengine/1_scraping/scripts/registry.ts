/**
 * Scraping — the dedup REGISTRY (shared between operators, versioned).
 *
 * Remembers every domain already seen (seeds + previous runs) AND every stable key (e.g. siren) already
 * tried, so that:
 *   - a re-run adds ONLY new rows to data/raw/prospects.scraped.csv;
 *   - we never retry an (expensive) enrichment on a company already tried without success.
 *
 * File: data/raw/prospects.registry.json (versioned — see .gitignore).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { domainOf, csvJoin, csvSplit, type Found } from "./util.ts"

const RAW = join("data", "raw")
const REGISTRY = join(RAW, "prospects.registry.json")
export const SCRAPED = join(RAW, "prospects.scraped.csv")

// existing CSVs counted as "already seen" (never offered again)
const SEEDS = ["cuisinistes.seed.csv", "prospects.seed.csv", "prospects.batch2.csv", "prospects.scraped.csv"]

type Entry = { name: string; industry: string; source: string; firstSeen: string }
type RegistryFile = { domains: Record<string, Entry>; keys: Record<string, string> }

export class Registry {
  private domains: Record<string, Entry> = {}
  private keys: Record<string, string> = {} // stable key (e.g. "sirene:<siren>") → date tried

  static async load(): Promise<Registry> {
    const r = new Registry()
    const raw: Partial<RegistryFile> = await readFile(REGISTRY, "utf8").then(JSON.parse, () => ({}))
    // backward compatibility: the old format = a flat domain→entry map
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

  // marks a stable key as tried (whether it worked or not) → no expensive retry
  markTried(key: string, date: string) { if (key) this.keys[key] = date }

  // records a kept prospect (with a site); returns false if the domain is already known
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

// the CSV's canonical schema (the pipeline reads by column NAME → adding `email` breaks nothing)
const HEADER = "name,city,website,phone,industry,email"
const row = (f: Found) => csvJoin([f.name, f.city, f.website, f.phone, f.industry, f.email ?? ""])

// appends rows; migrates the header to the canonical schema on the way (old 5-column files)
export async function appendCsv(rows: Found[]) {
  if (!rows.length) return
  await mkdir(RAW, { recursive: true })
  const existing = (await readFile(SCRAPED, "utf8").catch(() => "")).split("\n").filter(Boolean)
  const oldData = existing.length > 1 ? existing.slice(1).map((l) => (csvSplit(l).length >= 6 ? l : l + ",")) : []
  await writeFile(SCRAPED, [HEADER, ...oldData, ...rows.map(row)].join("\n") + "\n")
}
