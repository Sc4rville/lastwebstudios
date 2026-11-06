/**
 * handler.ts · LE TRAITEMENT d'un update Telegram (message ou bouton), séparé de bot.ts pour être testable.
 *
 * SÉCURITÉ (F-1, audit 2026-10-24) : le bot est FERMÉ PAR DÉFAUT. Seuls les chats listés dans
 * `TELEGRAM_ALLOWED_CHAT_IDS` (ids séparés par des virgules ; un groupe a un id négatif) sont servis.
 * Un chat inconnu n'est NI enrôlé (state.chats), NI notifié, NI capable de lancer /batch ou de laisser un
 * commentaire (qui finirait dans un prompt `claude -p` côté worker). Il est journalisé une fois, avec son id,
 * pour que l'opérateur puisse l'ajouter à la liste s'il s'agit bien de lui. Aucune réponse ne lui est faite
 * (on ne révèle pas l'existence du bot).
 *
 * Toutes les I/O passent par `deps` (réseau Telegram, DB, fichiers) → le test injecte des faux.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readControl, writeCommentText } from "../../packages/shared/control.ts"
import type { BatchMode } from "../../packages/shared/batch.ts"

export interface TgState { chats: number[]; seen: Record<string, number>; offset: number; msgMap: Record<string, string>; cmtTarget?: Record<number, string> }

export interface TgDeps {
  state: TgState
  allowed: Set<number>
  sitesDir: string
  sendMsg: (chat: number, text: string) => Promise<void>
  answerCb: (cbId: string, text: string) => Promise<void>
  editCaption: (chat: number, mid: number, caption: string) => Promise<void>
  setStatus: (id: string, date: string, status: string) => Promise<boolean>
  enqueueBatch: (o: { mode: BatchMode; lim: number | null; industry: string | null; requestedBy: string }) => Promise<{ id: number }>
  enqueueEdit: (id: string, date: string, requestedBy: string) => Promise<{ id: number }>
  hasDb: () => boolean
  save: () => void
  log: (line: string) => void
}

/** Longueur max d'un commentaire accepté depuis Telegram (le reste est coupé, jamais exécuté). */
export const MAX_COMMENT = 2000

const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))

/** `TELEGRAM_ALLOWED_CHAT_IDS="123, -100456"` → Set{123, -100456}. Entrée vide/invalide → ensemble vide (fermé). */
export function parseAllowlist(raw: string | undefined | null): { ids: Set<number>; invalid: string[] } {
  const ids = new Set<number>()
  const invalid: string[] = []
  for (const part of String(raw ?? "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)) {
    if (/^-?\d{1,20}$/.test(part)) ids.add(Number(part))
    else invalid.push(part)
  }
  return { ids, invalid }
}

const refusedOnce = new Set<number>()
/** Le chat est-il autorisé ? Sinon : journalisé (une fois par chat et par process), jamais servi. */
export function authorize(chat: number | undefined, d: TgDeps, who = ""): boolean {
  if (typeof chat === "number" && d.allowed.has(chat)) return true
  if (typeof chat === "number" && !refusedOnce.has(chat)) {
    refusedOnce.add(chat)
    d.log(`🚫 telegram : chat ${chat}${who ? ` (${who})` : ""} REFUSÉ, absent de TELEGRAM_ALLOWED_CHAT_IDS. Si c'est toi : ajoute ${chat} à TELEGRAM_ALLOWED_CHAT_IDS et relance le bot.`)
  }
  return false
}

/** Nettoie un commentaire reçu (caractères de contrôle retirés, longueur bornée). C'est une DONNÉE, pas un ordre. */
export function cleanComment(txt: string): string {
  return String(txt || "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, MAX_COMMENT)
}

const who = (from: any, chat: any) => [from?.username ? `@${from.username}` : "", chat?.title ? `« ${chat.title} »` : "", chat?.type || ""].filter(Boolean).join(" ")

/** Traite UN update Telegram. Ne lève jamais (les erreurs réseau/DB sont rendues à l'opérateur ou avalées). */
export async function handleUpdate(u: any, d: TgDeps): Promise<void> {
  const { state } = d
  if (typeof u?.update_id === "number") state.offset = u.update_id + 1

  // --- LE SWIPE : boutons ✅ approuver / ❌ écarter / 💬 commenter ---
  if (u?.callback_query) {
    const cb = u.callback_query
    const chat = cb.message?.chat?.id, mid = cb.message?.message_id
    if (!authorize(chat, d, who(cb.from, cb.message?.chat))) return
    const site = state.msgMap[`${chat}:${mid}`]
    if (!site) { await d.answerCb(cb.id, "session expirée"); return }
    const [id, date] = site.split("/")
    if (cb.data === "ok") {
      const ok = await d.setStatus(id, date, "approved")
      await d.answerCb(cb.id, ok ? "✅ approuvé" : "erreur DB")
      if (ok) await d.editCaption(chat, mid, `✅ <b>${esc(id)}</b> · ${esc(date)} · APPROUVÉ`)
    } else if (cb.data === "no") {
      const ok = await d.setStatus(id, date, "rejected")
      await d.answerCb(cb.id, ok ? "❌ écarté" : "erreur DB")
      if (ok) await d.editCaption(chat, mid, `❌ <b>${esc(id)}</b> · ${esc(date)} · écarté`)
    } else if (cb.data === "cmt") {
      await d.answerCb(cb.id, "Réponds à ce message avec ton commentaire")
      ;(state.cmtTarget ??= {})[chat] = site
    }
    d.save(); return
  }

  const msg = u?.message
  if (!msg?.text) return
  const chat = msg.chat?.id
  if (!authorize(chat, d, who(msg.from, msg.chat))) return // ni enrôlé, ni servi, ni transmis au worker
  if (!state.chats.includes(chat)) {
    state.chats.push(chat)
    await d.sendMsg(chat, "✅ Connecté ! <b>/batch composer 3</b> pour lancer une génération · les sites arrivent ici avec ✅/❌. <b>/help</b>")
  }
  const txt = String(msg.text).trim()

  // --- /help ---
  if (txt.startsWith("/start") || txt.startsWith("/help")) {
    await d.sendMsg(chat, "🤖 <b>lastwebstudios</b> : pilote la machine depuis ton tel, PC éteints.\n\n<b>/batch [composer|template] [N] [métier]</b> : lance une génération.\nEx : <code>/batch composer 3</code> · <code>/batch composer 2 pisciniste</code>\n\nLa box scrape → score → compose, puis te pousse <b>chaque site ici</b> avec <b>✅ approuver · ❌ écarter · 💬 commenter</b>. Réponds à un site pour le commenter → le worker l'applique.")
    d.save(); return
  }

  // --- /batch : lancer depuis le tel ---
  if (txt.startsWith("/batch")) {
    let mode: BatchMode = "composer", lim = 0, industry = ""
    for (const p of txt.split(/\s+/).slice(1)) {
      if (/^(composer|template|template-fill)$/i.test(p)) mode = /composer/i.test(p) ? "composer" : "template-fill"
      else if (/^\d+$/.test(p)) lim = parseInt(p, 10)
      else if (/^[a-zà-ÿ][a-zà-ÿ0-9-]{1,}$/i.test(p)) industry = p.toLowerCase() // un VRAI mot-métier
    }
    if (!d.hasDb()) { await d.sendMsg(chat, "✗ DATABASE_URL absent : le bot ne peut pas empiler (lance-le sur la box)."); return }
    try {
      const r = await d.enqueueBatch({ mode, lim: lim || null, industry: industry || null, requestedBy: `tg:${chat}` })
      await d.sendMsg(chat, `✓ Batch <b>#${r.id}</b> empilé (${mode}${lim ? ` · ${lim} sites` : ""}${industry ? ` · ${industry}` : ""}). La box bosse 🚀 : je te pousse chaque site ici dès qu'il est prêt.`)
    } catch (e) { await d.sendMsg(chat, `✗ erreur : ${esc((e as Error).message)}`) }
    d.save(); return
  }

  // --- commentaire (réponse à un site, ou cible 💬, sinon le plus récent) ---
  let target = msg.reply_to_message ? state.msgMap[`${chat}:${msg.reply_to_message.message_id}`] : undefined
  if (!target && state.cmtTarget?.[chat]) { target = state.cmtTarget[chat]; delete state.cmtTarget[chat] }
  if (!target) target = Object.keys(state.seen).sort((a, b) => state.seen[b] - state.seen[a])[0]
  if (!target) { await d.sendMsg(chat, "Aucune génération à commenter. <b>/batch composer 2</b> pour en lancer."); return }
  const [id, date] = target.split("/")
  if (!/^[a-z0-9._-]+$/i.test(id || "") || !/^\d{4}-\d{2}-\d{2}(-[a-z0-9._-]+)?$/i.test(date || "")) return
  const ctlPath = join(d.sitesDir, id, date, "control.md")
  if (!existsSync(join(d.sitesDir, id, date))) { await d.sendMsg(chat, `Génération introuvable : ${esc(target)}`); return }
  const comment = cleanComment(txt)
  if (!comment) return
  const prev = existsSync(ctlPath) ? readFileSync(ctlPath, "utf8") : ""
  const cur = (await readControl(ctlPath)).comment
  writeFileSync(ctlPath, writeCommentText(prev, cur ? `${cur}\n${comment}` : comment))
  let applied = " (au prochain review)"
  try { const e = await d.enqueueEdit(id, date, `tg:${chat}`); applied = ` → le worker l'applique (job #${e.id})` } catch { /* pas de DB → au prochain review */ }
  await d.sendMsg(chat, `📝 Commentaire sur <b>${esc(id)}</b> · ${esc(date)}${applied}.`)
  d.save()
}
