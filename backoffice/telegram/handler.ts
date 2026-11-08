/**
 * handler.ts · THE HANDLING of a Telegram update (message or button), kept apart from bot.ts so it can be tested.
 *
 * SECURITY (F-1, audit 2026-10-24): the bot is CLOSED BY DEFAULT. Only the chats listed in
 * `TELEGRAM_ALLOWED_CHAT_IDS` (comma-separated ids; a group has a negative id) are served.
 * An unknown chat is NEITHER enrolled (state.chats), NOR notified, NOR able to start /batch or leave a
 * comment (which would end up in a `claude -p` prompt on the worker). It is logged once, with its id,
 * so the operator can add it to the list if it really is them. It never gets an answer
 * (the bot's existence is not revealed).
 *
 * All I/O goes through `deps` (Telegram network, DB, files) → the test injects fakes.
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

/** Max length of a comment accepted from Telegram (the rest is cut off, never executed). */
export const MAX_COMMENT = 2000

const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))

/** `TELEGRAM_ALLOWED_CHAT_IDS="123, -100456"` → Set{123, -100456}. Empty/invalid input → empty set (closed). */
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
/** Is the chat allowed? Otherwise: logged (once per chat and per process), never served. */
export function authorize(chat: number | undefined, d: TgDeps, who = ""): boolean {
  if (typeof chat === "number" && d.allowed.has(chat)) return true
  if (typeof chat === "number" && !refusedOnce.has(chat)) {
    refusedOnce.add(chat)
    d.log(`🚫 telegram : chat ${chat}${who ? ` (${who})` : ""} REFUSÉ, absent de TELEGRAM_ALLOWED_CHAT_IDS. Si c'est toi : ajoute ${chat} à TELEGRAM_ALLOWED_CHAT_IDS et relance le bot.`)
  }
  return false
}

/** Cleans a received comment (control characters removed, bounded length). It is DATA, not an order. */
export function cleanComment(txt: string): string {
  return String(txt || "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, MAX_COMMENT)
}

const who = (from: any, chat: any) => [from?.username ? `@${from.username}` : "", chat?.title ? `« ${chat.title} »` : "", chat?.type || ""].filter(Boolean).join(" ")

/** Handles ONE Telegram update. Never throws (network/DB errors are reported to the operator or swallowed). */
export async function handleUpdate(u: any, d: TgDeps): Promise<void> {
  const { state } = d
  if (typeof u?.update_id === "number") state.offset = u.update_id + 1

  // --- THE SWIPE: buttons ✅ approve / ❌ skip / 💬 comment ---
  if (u?.callback_query) {
    const cb = u.callback_query
    const chat = cb.message?.chat?.id, mid = cb.message?.message_id
    if (!authorize(chat, d, who(cb.from, cb.message?.chat))) return
    const site = state.msgMap[`${chat}:${mid}`]
    if (!site) { await d.answerCb(cb.id, "session expired"); return }
    const [id, date] = site.split("/")
    if (cb.data === "ok") {
      const ok = await d.setStatus(id, date, "approved")
      await d.answerCb(cb.id, ok ? "✅ approved" : "database error")
      if (ok) await d.editCaption(chat, mid, `✅ <b>${esc(id)}</b> · ${esc(date)} · APPROVED`)
    } else if (cb.data === "no") {
      const ok = await d.setStatus(id, date, "rejected")
      await d.answerCb(cb.id, ok ? "❌ skipped" : "database error")
      if (ok) await d.editCaption(chat, mid, `❌ <b>${esc(id)}</b> · ${esc(date)} · skipped`)
    } else if (cb.data === "cmt") {
      await d.answerCb(cb.id, "Reply to this message with your comment")
      ;(state.cmtTarget ??= {})[chat] = site
    }
    d.save(); return
  }

  const msg = u?.message
  if (!msg?.text) return
  const chat = msg.chat?.id
  if (!authorize(chat, d, who(msg.from, msg.chat))) return // not enrolled, not served, not passed to the worker
  if (!state.chats.includes(chat)) {
    state.chats.push(chat)
    await d.sendMsg(chat, "✅ Connecté ! <b>/batch composer 3</b> pour lancer une génération · les sites arrivent ici avec ✅/❌. <b>/help</b>")
  }
  const txt = String(msg.text).trim()

  // --- /help ---
  if (txt.startsWith("/start") || txt.startsWith("/help")) {
    await d.sendMsg(chat, "🤖 <b>lastwebstudios</b>: run the machine from your phone, computers off.\n\n<b>/batch [composer|template] [N] [trade]</b>: starts a build.\nE.g. <code>/batch composer 3</code> · <code>/batch composer 2 pisciniste</code>\n\nThe box scrapes → scores → composes, then sends you <b>each site here</b> with <b>✅ approve · ❌ skip · 💬 comment</b>. Reply to a site to comment on it → the worker applies it.")
    d.save(); return
  }

  // --- /batch: start from the phone ---
  if (txt.startsWith("/batch")) {
    let mode: BatchMode = "composer", lim = 0, industry = ""
    for (const p of txt.split(/\s+/).slice(1)) {
      if (/^(composer|template|template-fill)$/i.test(p)) mode = /composer/i.test(p) ? "composer" : "template-fill"
      else if (/^\d+$/.test(p)) lim = parseInt(p, 10)
      else if (/^[a-zà-ÿ][a-zà-ÿ0-9-]{1,}$/i.test(p)) industry = p.toLowerCase() // a REAL trade word
    }
    if (!d.hasDb()) { await d.sendMsg(chat, "✗ DATABASE_URL is missing: the bot cannot queue (run it on the box)."); return }
    try {
      const r = await d.enqueueBatch({ mode, lim: lim || null, industry: industry || null, requestedBy: `tg:${chat}` })
      await d.sendMsg(chat, `✓ Batch <b>#${r.id}</b> queued (${mode}${lim ? ` · ${lim} sites` : ""}${industry ? ` · ${industry}` : ""}). The box is on it 🚀: I'll send you each site here as soon as it is ready.`)
    } catch (e) { await d.sendMsg(chat, `✗ erreur : ${esc((e as Error).message)}`) }
    d.save(); return
  }

  // --- comment (reply to a site, or the 💬 target, otherwise the most recent) ---
  let target = msg.reply_to_message ? state.msgMap[`${chat}:${msg.reply_to_message.message_id}`] : undefined
  if (!target && state.cmtTarget?.[chat]) { target = state.cmtTarget[chat]; delete state.cmtTarget[chat] }
  if (!target) target = Object.keys(state.seen).sort((a, b) => state.seen[b] - state.seen[a])[0]
  if (!target) { await d.sendMsg(chat, "No build to comment on. <b>/batch composer 2</b> to start one."); return }
  const [id, date] = target.split("/")
  if (!/^[a-z0-9._-]+$/i.test(id || "") || !/^\d{4}-\d{2}-\d{2}(-[a-z0-9._-]+)?$/i.test(date || "")) return
  const ctlPath = join(d.sitesDir, id, date, "control.md")
  if (!existsSync(join(d.sitesDir, id, date))) { await d.sendMsg(chat, `Build not found: ${esc(target)}`); return }
  const comment = cleanComment(txt)
  if (!comment) return
  const prev = existsSync(ctlPath) ? readFileSync(ctlPath, "utf8") : ""
  const cur = (await readControl(ctlPath)).comment
  writeFileSync(ctlPath, writeCommentText(prev, cur ? `${cur}\n${comment}` : comment))
  let applied = " (at the next review)"
  try { const e = await d.enqueueEdit(id, date, `tg:${chat}`); applied = ` → the worker applies it (job #${e.id})` } catch { /* no DB → at the next review */ }
  await d.sendMsg(chat, `📝 Comment on <b>${esc(id)}</b> · ${esc(date)}${applied}.`)
  d.save()
}
