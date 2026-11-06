/**
 * reindex.ts — synchronise la DB depuis le FILESYSTEM (une seule direction : FS → DB).
 *
 * Les colonnes-cache sont écrasées par le FS (le fichier gagne). Les colonnes DB-owned (status,
 * sent_at, included, use_count…) ne sont JAMAIS touchées : les UPSERT listent explicitement les seules
 * colonnes-cache. La DB est ainsi reconstructible à tout moment sans perdre l'état de workflow.
 *
 * Réutilise les parseurs existants (parseControl, readSkills, readStash) → la logique de parsing reste
 * single-sourced. DB désormais Postgres/Supabase (async) → chaque requête est `await`.
 */
import { readdir, readFile, stat } from "node:fs/promises"
import { existsSync, statSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join, extname } from "node:path"
import { getDb } from "./db.ts"
import { exists as storageExists } from "./storage.ts"
import { parseControl } from "./control.ts"
import { readSkills, readStash } from "../../backoffice/reviewpipe/skills.ts"

const PROSPECTS = "data/prospects"
const SITES = "output/sites"
const DATA_ASSETS = "data/assets"

function isDir(p: string): boolean { try { return statSync(p).isDirectory() } catch { return false } }
const mtimeOf = (p: string): number => { try { return Math.round(statSync(p).mtimeMs) } catch { return 0 } }

// ════════ prospects (cache pur) ════════

export async function reindexProspect(id: string): Promise<void> {
  const file = join(PROSPECTS, `${id}.json`)
  if (!existsSync(file)) return
  const db = getDb()
  const mtime = mtimeOf(file)
  const existing = await db.prepare("SELECT sheet_mtime FROM prospects WHERE id=?").get(id) as { sheet_mtime: number } | undefined
  if (existing && existing.sheet_mtime === mtime) {
    await db.prepare("UPDATE prospects SET present=1 WHERE id=?").run(id)
    return
  }
  let s: any
  try { s = JSON.parse(await readFile(file, "utf8")) } catch { return }
  const screenshot = s.existing?.screenshot
    ? join("data", s.existing.screenshot).replace(/^data\//, "")
    : existsSync(join(DATA_ASSETS, id, "avant.png")) ? `assets/${id}/avant.png` : null
  await db.prepare(`
    INSERT INTO prospects (id,industry,name,city,zone,phone,email,existing_url,screenshot_path,
      tagline,about,services_json,brands_json,opp_score,opp_tier,opp_reasons_json,sheet_mtime,sheet_json,present,indexed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)
    ON CONFLICT(id) DO UPDATE SET
      industry=excluded.industry, name=excluded.name, city=excluded.city, zone=excluded.zone,
      phone=excluded.phone, email=excluded.email, existing_url=excluded.existing_url,
      screenshot_path=excluded.screenshot_path, tagline=excluded.tagline, about=excluded.about,
      services_json=excluded.services_json, brands_json=excluded.brands_json, opp_score=excluded.opp_score,
      opp_tier=excluded.opp_tier, opp_reasons_json=excluded.opp_reasons_json, sheet_mtime=excluded.sheet_mtime,
      sheet_json=excluded.sheet_json, present=1, indexed_at=excluded.indexed_at
  `).run(
    id, s.industry ?? null, s.identity?.name ?? null, s.identity?.city ?? null, s.identity?.zone ?? null,
    s.identity?.phone ?? null, s.identity?.email ?? null, s.existing?.url ?? null, screenshot,
    s.content?.tagline ?? null, s.content?.about ?? null,
    s.content?.services ? JSON.stringify(s.content.services) : null,
    s.content?.brands ? JSON.stringify(s.content.brands) : null,
    s.score?.value ?? null, s.score?.tier ?? null,
    s.score?.reasons ? JSON.stringify(s.score.reasons) : null,
    mtime, JSON.stringify(s), Date.now(),
  )
  await reindexAssets(id)
}

/** Garantit une ligne prospect (stub si la fiche n'existe pas localement — un site peut exister sans sa fiche). */
async function ensureProspect(id: string): Promise<void> {
  await getDb().prepare("INSERT INTO prospects(id,present,indexed_at) VALUES(?,1,?) ON CONFLICT(id) DO NOTHING").run(id, Date.now())
}

// ════════ generations (cache + colonnes DB-owned préservées) ════════

const SLUG_RE = /^(\d{4}-\d{2}-\d{2})(?:-(.+))?$/

export async function reindexSite(id: string, dirSlug: string): Promise<void> {
  const dir = join(SITES, id, dirSlug)
  if (!isDir(dir)) return
  const db = getDb()
  const ctlPath = join(dir, "control.md")
  const mtime = mtimeOf(ctlPath)
  // GATE du coach : tant que `.reviewing` existe (le coach revoit/corrige le site), on le garde NON publié
  // (has_index=0 → « coach en cours » au cockpit, jamais le brouillon). Le worker retire le marqueur après.
  const reviewing = existsSync(join(dir, ".reviewing"))
  const hasIndex = (!reviewing && existsSync(join(dir, "index.html"))) ? 1 : 0
  const prior = await db.prepare("SELECT control_mtime, has_index FROM generations WHERE prospect_id=? AND dir_slug=?").get(id, dirSlug) as { control_mtime: number; has_index: number } | undefined
  // court-circuit SEULEMENT si rien n'a bougé : ni le control.md (mtime) NI l'index.html (apparu/disparu).
  // Sans le check has_index, un index.html écrit juste après le control.md restait invisible à jamais
  // (le mtime du control.md ne rebouge plus → has_index figé à 0 → preview « Not found »).
  if (prior && prior.control_mtime === mtime && mtime !== 0 && prior.has_index === hasIndex) {
    await db.prepare("UPDATE generations SET present=1 WHERE prospect_id=? AND dir_slug=?").run(id, dirSlug)
    return
  }
  await ensureProspect(id)
  const ctl = existsSync(ctlPath) ? parseControl(await readFile(ctlPath, "utf8")) : null
  const m = SLUG_RE.exec(dirSlug)
  const genDate = m ? m[1] : null
  const variant = m && m[2] ? m[2] : null
  // created_at = instant de CRÉATION stable (mtime de l'index.html au 1er index) — figé pour de bon
  // (ON CONFLICT ne le met PAS à jour) → le tri chronologique du cockpit n'est jamais bumpé par un re-sync.
  const created = mtimeOf(join(dir, "index.html")) || mtime || Date.now()
  await db.prepare(`
    INSERT INTO generations (prospect_id,dir_slug,gen_date,variant,has_index,template,counts,
      generated_label,has_comment,control_mtime,present,indexed_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)
    ON CONFLICT(prospect_id,dir_slug) DO UPDATE SET
      gen_date=excluded.gen_date, variant=excluded.variant, has_index=excluded.has_index,
      template=excluded.template, counts=excluded.counts, generated_label=excluded.generated_label,
      has_comment=excluded.has_comment, control_mtime=excluded.control_mtime, present=1,
      indexed_at=excluded.indexed_at
  `).run(
    id, dirSlug, genDate, variant,
    hasIndex,
    ctl?.template ?? null, ctl?.counts ?? null, ctl?.generated ?? null,
    ctl?.hasComment ? 1 : 0, mtime, Date.now(), created,
  )
}

/** Retire une génération de l'index (après suppression du dossier disque) — pour que le cockpit cesse de l'afficher. */
export async function pruneGeneration(id: string, dirSlug: string): Promise<void> {
  await getDb().prepare("DELETE FROM generations WHERE prospect_id=? AND dir_slug=?").run(id, dirSlug)
}

// ════════ assets (cache + included préservé) ════════

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".avif": "image/avif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
}
function assetKind(name: string): string {
  const low = name.toLowerCase()
  if (/\.(mp4|webm|mov)$/.test(low)) return "video"
  if (low.startsWith("avant")) return "avant"
  if (low.startsWith("logo")) return "logo"
  if (low.includes("poster")) return "poster"
  return "photo"
}

export async function reindexAssets(id: string): Promise<void> {
  const dir = join(DATA_ASSETS, id)
  if (!isDir(dir)) return
  const db = getDb()
  await ensureProspect(id)
  let files: string[]
  try { files = await readdir(dir) } catch { return }
  const seen = new Set<string>()
  for (const f of files) {
    const abs = join(dir, f)
    if (!isFileAsset(abs)) continue
    const rel = `assets/${id}/${f}`
    seen.add(rel)
    const mtime = mtimeOf(abs)
    // hash mtime-guardé : on ne relit/re-hashe que si le fichier a changé (sinon on garde l'empreinte)
    const prior = await db.prepare("SELECT mtime, hash FROM assets WHERE prospect_id=? AND rel_path=?").get(id, rel) as { mtime: number; hash: string | null } | undefined
    const hash = prior && prior.mtime === mtime && prior.hash ? prior.hash : hashFile(abs)
    await db.prepare(`
      INSERT INTO assets (prospect_id,rel_path,kind,mime,mtime,hash,present)
      VALUES (?,?,?,?,?,?,1)
      ON CONFLICT(prospect_id,rel_path) DO UPDATE SET
        kind=excluded.kind, mime=excluded.mime, mtime=excluded.mtime, hash=excluded.hash, present=1
    `).run(id, rel, assetKind(f), MIME[extname(f).toLowerCase()] ?? null, mtime, hash)
  }
  // marquer absents ceux qui ne sont plus sur disque (soft-delete : on garde l'historique)
  const rows = await db.prepare("SELECT rel_path FROM assets WHERE prospect_id=? AND present=1").all(id) as { rel_path: string }[]
  for (const r of rows) if (!seen.has(r.rel_path)) await db.prepare("UPDATE assets SET present=0 WHERE prospect_id=? AND rel_path=?").run(id, r.rel_path)
}
function isFileAsset(p: string): boolean { try { return statSync(p).isFile() } catch { return false } }
function hashFile(p: string): string | null { try { return createHash("sha256").update(readFileSync(p)).digest("hex") } catch { return null } }

// ════════ brain : skills + ideas (cache, DB-owned préservé) ════════

export async function reindexSkills(): Promise<void> {
  const db = getDb()
  const skills = await readSkills()
  const seen = new Set<string>()
  for (const s of skills) {
    seen.add(s.name)
    await db.prepare(`
      INSERT INTO skills (name,status,kind,description,has_feedback,file_mtime,present,indexed_at)
      VALUES (?,?,?,?,?,?,1,?)
      ON CONFLICT(name) DO UPDATE SET
        status=excluded.status, kind=excluded.kind, description=excluded.description,
        has_feedback=excluded.has_feedback, file_mtime=excluded.file_mtime, present=1, indexed_at=excluded.indexed_at
    `).run(s.name, s.status, s.kind, s.desc, s.feedback ? 1 : 0, Math.round(s.mtime), Date.now())
  }
  for (const r of await db.prepare("SELECT name FROM skills WHERE present=1").all() as { name: string }[])
    if (!seen.has(r.name)) await db.prepare("UPDATE skills SET present=0 WHERE name=?").run(r.name)
}

export async function reindexStash(): Promise<void> {
  const db = getDb()
  const ideas = await readStash()
  const seen = new Set<string>()
  for (const i of ideas) {
    if (!i.slug) continue
    seen.add(i.slug)
    await db.prepare(`
      INSERT INTO ideas (slug,idea,signal,note,category,drafted,present,indexed_at)
      VALUES (?,?,?,?,?,?,1,?)
      ON CONFLICT(slug) DO UPDATE SET
        idea=excluded.idea, signal=excluded.signal, note=excluded.note, category=excluded.category,
        drafted=excluded.drafted, present=1, indexed_at=excluded.indexed_at
    `).run(i.slug, i.idea, i.signal, i.note, i.category, i.drafted ? 1 : 0, Date.now())
  }
  for (const r of await db.prepare("SELECT slug FROM ideas WHERE present=1").all() as { slug: string }[])
    if (!seen.has(r.slug)) await db.prepare("UPDATE ideas SET present=0 WHERE slug=?").run(r.slug)
}

// ════════ full reindex (boot) ════════

export async function reindexAll(): Promise<{ prospects: number; generations: number; ms: number }> {
  const t0 = Date.now()
  const db = getDb()
  // prospects
  let nP = 0, nG = 0
  if (existsSync(PROSPECTS)) {
    const seen = new Set<string>()
    for (const f of await readdir(PROSPECTS)) {
      if (!f.endsWith(".json") || f.endsWith(".example.json")) continue
      const id = f.replace(/\.json$/, "")
      seen.add(id)
      try { await reindexProspect(id); nP++ } catch { /* fiche cassée → ignorée */ }
    }
    for (const r of await db.prepare("SELECT id FROM prospects WHERE present=1").all() as { id: string }[]) {
      if (seen.has(r.id) || isDir(join(SITES, r.id))) continue
      // pas en local : ne PAS cacher un prospect dont l'avant est dans le BUCKET (il est réel, sa fiche vit
      // juste sur une autre machine). Évite qu'un reindex sur une machine PARTIELLE (la box) vide la liste.
      let inBucket = false
      try { inBucket = await storageExists(`prospects/${r.id}/avant.png`) } catch { /* bucket indispo → comportement d'origine */ }
      if (!inBucket) await db.prepare("UPDATE prospects SET present=0 WHERE id=?").run(r.id)
    }
  }
  // generations
  if (existsSync(SITES)) {
    const seen = new Set<string>()
    for (const id of await readdir(SITES)) {
      if (!isDir(join(SITES, id))) continue
      for (const slug of await readdir(join(SITES, id))) {
        if (!isDir(join(SITES, id, slug))) continue
        seen.add(`${id}/${slug}`)
        try { await reindexSite(id, slug); nG++ } catch { /* dir cassé → ignoré */ }
        try { await reindexAssets(id) } catch { /* */ }
      }
    }
    for (const r of await db.prepare("SELECT prospect_id,dir_slug FROM generations WHERE present=1").all() as { prospect_id: string; dir_slug: string }[]) {
      if (seen.has(`${r.prospect_id}/${r.dir_slug}`)) continue
      // pas sur le FS local : ne PAS cacher si le site existe dans le BUCKET (composé sur une autre machine).
      // DB + bucket = la source partagée ; un site présent au bucket reste visible au cockpit, peu importe
      // quelle machine détient les fichiers. Sans ça, un reindex sur la box masque les sites composés en local.
      let inBucket = false
      try { inBucket = await storageExists(`sites/${r.prospect_id}/${r.dir_slug}/index.html`) } catch { /* bucket indispo → comportement FS d'origine */ }
      if (!inBucket) await db.prepare("UPDATE generations SET present=0 WHERE prospect_id=? AND dir_slug=?").run(r.prospect_id, r.dir_slug)
    }
  }
  await reindexSkills().catch(() => {})
  await reindexStash().catch(() => {})
  const ms = Date.now() - t0
  await db.prepare("INSERT INTO meta(key,value,updated_at) VALUES('last_full_reindex_at',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(String(Date.now()), Date.now())
  return { prospects: nP, generations: nG, ms }
}

// CLI : tsx packages/shared/reindex.ts  (backfill manuel / debug)
if (import.meta.url === `file://${process.argv[1]}`) {
  reindexAll().then((r) => { console.log(`✓ reindex : ${r.prospects} prospects · ${r.generations} générations · ${r.ms}ms`); process.exit(0) })
    .catch((e) => { console.error(e); process.exit(1) })
}
