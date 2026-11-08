// Last Web Studios · cockpit. Three steps, left to right: Prospects → Sites → Outreach. A few sheets.
import { L, setLocale, place, phone as fmtPhone, telHref, owner, date as fmtDate, dateTime, time, weekday, slots, zoneName, wall, zoned, toLocalInput, fromLocalInput } from "/locale.js"
const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const enc = encodeURIComponent
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
const IC = {
  phone: `<svg class="ic" viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.7a16 16 0 0 0 6.2 6.2l1.3-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2z"/></svg>`,
  globe: `<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
  eye: `<svg class="ic" viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
  hammer: `<svg class="ic" viewBox="0 0 24 24"><path d="m15 12-8.5 8.5a2.1 2.1 0 0 1-3-3L12 9"/><path d="M17.6 15 21 11.6 14.4 5 11 8.4l6.6 6.6zM9 4l1 1"/></svg>`,
  arrow: `<svg class="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  x: `<svg class="ic" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  bill: `<svg class="ic" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></svg>`,
  check: `<svg class="ic" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>`,
  ext: `<svg class="ic" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`,
  copy: `<svg class="ic" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>`,
  trash: `<svg class="ic" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`,
  pencil: `<svg class="ic" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>`,
  chev: `<svg class="ic chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`,
  checks: `<svg class="ic" viewBox="0 0 24 24"><path d="M3 7l2 2 4-4M3 17l2 2 4-4M13 6h8M13 12h8M13 18h8"/></svg>`,
  trend: `<svg class="ic" viewBox="0 0 24 24"><path d="m3 17 6-6 4 4 8-8M15 7h6v6"/></svg>`,
  mail: `<svg class="ic" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`,
  cal: `<svg class="ic" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`,
}
let serverGone = false
async function api(path, body) {
  const opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  try { const r = await fetch(path, opt); if (serverGone) { serverGone = false; $("#banner").hidden = true } return await r.json().catch(() => ({})) }
  catch { if (!serverGone) { serverGone = true; $("#banner").textContent = "Server stopped. Start it again with npm run backoffice (or npm run sandbox)."; $("#banner").hidden = false } return { error: "Server stopped", gone: true } }
}
/* ───────── feedback: toast, loading buttons, job strip ───────── */
/** a short line at the bottom (under the header on a phone) ; `o.undo` adds an Undo button, `o.remember` the lime dot of
 *  « what the agency will remember » */
function toast(msg, bad = false, o = {}) {
  if (/Server stopped/.test(msg)) return
  const t = document.createElement("div"); t.className = "toast" + (bad ? " bad" : "") + (o.remember ? " remember" : ""); t.setAttribute("role", bad ? "alert" : "status")
  t.append(Object.assign(document.createElement("span"), { textContent: msg }))
  if (o.undo) { const b = Object.assign(document.createElement("button"), { type: "button", className: "btn sm quiet", textContent: o.undoLabel || "Undo" }); b.onclick = async () => { t.remove(); await o.undo() }; t.append(b) }
  $("#toasts").appendChild(t); setTimeout(() => t.remove(), bad ? 5000 : o.undo ? 7000 : 2600)
}
/** toasts are placed by the stylesheet (bottom centre, above any bar ; under the header on a phone) */
function placeToasts() { /* kept for the callers : the place is the stylesheet's */ }
window.addEventListener("resize", placeToasts)
async function busy(btn, fn) { if (!btn || btn.classList.contains("loading")) return; btn.classList.add("loading"); btn.setAttribute("aria-busy", "true"); try { return await fn() } finally { btn.classList.remove("loading"); btn.removeAttribute("aria-busy") } }
const short = (s, n = 32) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s }
const jobs = { rows: new Map(), live: new Map(), open: false, seen: new Set(), flashed: new Set() }
async function loadJobs() { const r = await api("/api/jobs"); if (!r || !r.jobs) return; const pending = [...jobs.rows].filter(([k]) => k < 0); jobs.rows = new Map([...pending, ...r.jobs.map((j) => [j.id, j])]); jobs.paused = !!r.paused; renderJobs(); renderPaused() }
const PAUSED = "Paused — resume to run"
const NO_DB_FIND = "Finding prospects needs a database: npm run backoffice starts a local one"
const paused = () => !!(state.cage && state.cage.stop.on)
function renderPaused() {
  renderFindState()
  // the cards and the site inspector carry the paused state in their own render (a re-render never re-enables Build)
  if (state.prospectsData) renderProspects()
  renderInspect()
}
/** Find, bulk Build and the note under the field : stopped, or no database (never re-renders the list itself) */
function renderFindState() {
  const p = paused(), d = state.prospectsData, noDb = !!(d && d.noDb)
  const why = noDb ? (d.noDbWhy || NO_DB_FIND) : ""
  for (const id of ["#findBtn", "#bulkBuild"]) { const b = $(id); if (!b) continue; b.disabled = p || (id === "#findBtn" && noDb); b.title = p ? PAUSED : noDb && id === "#findBtn" ? why.replace(/`/g, "") : "" }
  if ($("#findText")) $("#findText").title = p ? PAUSED : ""
  const note = $("#findNote"); if (!note) return
  note.hidden = !p && !(noDb && state.noDbAsked)
  note.innerHTML = p ? `Stopped: nothing runs until you resume. <button type="button" class="linkbtn link" id="findResume">Resume</button>` : noDb && state.noDbAsked ? `<span class="bad">${code(why)}</span>` : ""
  const r = $("#findResume"); if (r) r.onclick = openCage
}
function jobTitle(j) {
  const p = j.params || {}
  if (j.mode === "find") { const what = (p.trades || []).map((t) => tradePlural(lowerTrade(trade(t)))).join(", ") || "a mix of trades"; return `Finding ${what}${p.place ? ` near ${p.place}` : ""}` }
  if (j.mode === "composer") { const ids = (j.live && j.live.ids) || p.ids || []; return ids.length ? `Building ${ids.length === 1 ? short(siteNameOf(ids[0])) : `${ids.length} sites`}` : "Building sites" }
  if (j.mode === "edit") return `Applying your feedback${p.id ? ` on ${short(siteNameOf(p.id))}` : ""}`
  if (j.mode === "research") return "Preparing the call script"
  return "Working"
}
/** « HVAC contractor », « plumber » : a trade in a sentence (acronyms keep their capitals) */
const lowerTrade = (t) => String(t || "").split(" ").map((w) => /^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase()).join(" ")
function siteNameOf(id) { const p = state.prospectsData && state.prospectsData.items.find((x) => x.id === id); return p ? p.name : (state.leads[id] && state.leads[id].name) || (state.sites.find((s) => s.id === id) || {}).name || id.replace(/-/g, " ") }
function jobLine(j) {
  const title = jobTitle(j)
  const done = j.status === "done", err = j.status === "error", queued = j.status === "queued"
  let line = err ? (j.error || "failed") : done ? (j.text || "done") : queued ? (jobs.paused ? "Paused" : "Waiting its turn") : (j.text || "running")
  if (line.startsWith(title)) line = line.slice(title.length).replace(/^\s*[·:-]\s*/, "") || "running"
  // « Building Bassins Noriac » + « Bassins Noriac · designing the new site » reads the name once
  for (const id of (j.params && j.params.ids) || (j.params && j.params.id ? [j.params.id] : [])) { const nm = siteNameOf(id); if (nm && line.startsWith(nm)) line = line.slice(nm.length).replace(/^\s*[·:-]\s*/, "") || "running" }
  const pct = done ? 100 : typeof j.pct === "number" ? j.pct : null
  return { title, line, done, err, queued, pct }
}
function renderJobs() {
  const all = [...jobs.rows.values()].map((j) => ({ ...j, ...(jobs.live.get(j.id) || {}), live: jobs.live.get(j.id) }))
  const rank = (j) => (j.status === "running" ? 0 : j.status === "queued" ? 1 : 2)
  const strip = (list0, host) => {
    const el = $(host); if (!el) return
    if (!list0.length) { el.innerHTML = ""; delete el.dataset.sig; return }
    // what is happening now first : the running jobs, then the ones waiting their turn, then what just finished
    const list = list0.slice().sort((a, b) => rank(a) - rank(b))
    const shown = list.slice(0, 2), rest = list.length - shown.length
    const first = shown[0], f = jobLine(first)
    // the strip flashes once when the job it shows completes (the progress has somewhere to land)
    const key = `${host}:${first.id}`; if (!f.done) jobs.seen.add(key)
    const fin = f.done && jobs.seen.has(key) && !jobs.flashed.has(key); if (fin) jobs.flashed.add(key)
    // a cell : a live dot, what it is, where it is ; a running job draws its thin lime line (a waiting one draws none)
    const cell = (j) => { const x = jobLine(j); const dot = x.err ? `<span class="dot bad"></span>` : x.done ? "" : x.queued ? `<span class="dot"></span>` : `<span class="dot live"></span>`
      const pct = !x.done && !x.err && !x.queued && x.pct != null ? ` · ${Math.round(x.pct)}%` : ""
      const bar = x.done || x.err || x.queued ? "" : `<span class="bar"><i class="${x.pct == null ? "indet" : ""}" style="${x.pct == null ? "" : `width:${x.pct}%`}"></i></span>`
      return `<div class="jcell">${dot}<span class="t">${esc(x.title)}</span><span class="s ${x.err ? "bad" : x.done ? "ok" : ""}">${x.done ? IC.check : ""}${esc(x.line)}${pct}</span>${bar}</div>` }
    const more = rest ? `<div class="jcell more">${jobs.open ? "Hide" : `+${rest} more`}</div>` : ""
    const html = `<div class="jobstrip" id="${host.slice(1)}Strip" ${rest ? `role="button" tabindex="0" aria-expanded="${jobs.open ? "true" : "false"}"` : ""}>${shown.map(cell).join("")}${more}</div>${jobs.open && rest ? `<div class="joblist">${list.slice(2).map(cell).join("")}</div>` : ""}`
    if (el.dataset.sig === html && el.firstChild) return // nothing moved: the element (its focus, its animation) stays
    const had = document.activeElement && el.contains(document.activeElement)
    el.innerHTML = html; el.dataset.sig = html
    const st = el.querySelector(".jobstrip")
    if (fin) st.classList.add("fin")
    st.onclick = () => { if (!rest) return; jobs.open = !jobs.open; renderJobs() }
    // « 1 site built » opens that site in Sites
    const built = !rest && shown.length === 1 && f.done && first.mode === "composer" ? ((first.live && (first.live.done || first.live.ids)) || (first.params && first.params.ids) || []) : []
    if (built.length) { st.setAttribute("role", "button"); st.tabIndex = 0; st.title = "Open it in Sites"; st.classList.add("go"); st.onclick = () => openSite(built[built.length - 1]) }
    if (had && rest) st.focus()
  }
  strip(all.filter((j) => j.mode === "find" || j.mode === "composer" || j.mode === "edit"), "#jobs")
  strip(all.filter((j) => j.mode === "composer" || j.mode === "edit"), "#jobsSites")
  strip(all.filter((j) => j.mode === "research"), "#jobsOut")
  renderBuildingPane()
  // a card being built shows its progress on itself
  if (state.prospectsData && state.view === "prospects") paintBuilding()
}
/** what the last search brought, said under the field until the next one (never only in a strip that disappears) :
 *  « Found 12 of 20 plumbers near Austin, TX: the demo finds up to 12 per search. » */
function sayFindDone(d) {
  const el = $("#findDone"); if (!el) return
  const j = jobs.rows.get(d.id) || {}, p = j.params || {}
  const what = listAnd((p.trades || []).map((t) => lowerTrade(trade(t))).map((t) => tradePlural(t))) || "businesses"
  const where = p.place ? ` near ${p.place}` : ""
  const found = d.found || 0, asked = d.asked || 0
  const head = asked && found < asked ? `Found ${found} of ${asked} ${what}${where}` : `Found ${found} ${found === 1 ? what.replace(/s$/, "") : what}${where}`
  const why = d.stopped ? ": stopped before the end." : d.capped ? `: the demo finds up to ${d.capped} per search.` : asked && found < asked ? ": that's every one nearby with a dated site. Widen the area to find more." : "."
  el.textContent = head + why; el.hidden = false
}
function onJobEvent(d) {
  const prev = jobs.live.get(d.id) || {}
  jobs.live.set(d.id, { ...prev, ...d })
  if (!jobs.rows.has(d.id)) loadJobs(); else renderJobs()
  if (d.status === "done" && prev.status !== "done") {
    // the result of a search is said once, under the field (never a toast and a line and a strip saying the same)
    if (d.mode === "find") sayFindDone(d)
    if (d.mode === "composer") {
      const done = (d.done || d.ids || []); if (done.length) state.lastBuilt = done[done.length - 1]
      // Sites opens on the site just built when you go there next ; a sheet open is not interrupted by a toast
      if (state.view !== "sites") { if (state.lastBuilt) state.openId = state.lastBuilt; if ($("#sheet").hidden) toast(done.length > 1 ? `${done.length} sites built: they're in Sites` : `${siteNameOf(state.lastBuilt || "")} is built: it's in Sites`) }
    }
    if (d.mode === "edit") toast(d.unchanged ? "Feedback noted: this demo site can't show it" : "Feedback applied")
    // a finished job says so for a few seconds, then leaves the strip (the result is in its view)
    setTimeout(() => { jobs.rows.delete(d.id); jobs.live.delete(d.id); renderJobs() }, 5000)
  }
  if (d.status === "error") toast(d.text || "Something failed", true)
}
/** go to Sites with that prospect's newest site selected */
function openSite(id) { state.openId = id; if (state.view === "sites") loadSites(); else location.hash = "#sites" }
const TRADE = {}
const trade = (k) => TRADE[k] || (k ? k[0].toUpperCase() + k.slice(1).replace(/-/g, " ") : "")
const when = (ms) => { if (!ms) return ""; const d = (Date.now() - ms) / 60000; if (d < 1) return "just now"; if (d < 60) return `${Math.round(d)} min ago`; const h = Math.round(d / 60); if (d < 1440) return `${h} hour${h === 1 ? "" : "s"} ago`; const k = Math.round(d / 1440); if (d < 43200) return `${k} day${k === 1 ? "" : "s"} ago`; return fmtDate(ms) }
const usd = (n) => n == null ? "—" : `$${Number(n).toFixed(2)}`

const state = {
  view: "prospects", sites: [], leads: {}, batches: [], sel: null, viewMode: "after", vp: "full", beforeFor: null,
  crm: null, stages: null, agent: null, agency: null, settings: null, lead: null, ltab: "script", prospectsData: null, psel: new Set(), outreachCount: null, openId: null, cage: null, boardFilter: null, filters: { trade: "", city: "", status: "" },
}

/* ───────── routing ───────── */
const VIEWS = ["prospects", "sites", "outreach"]
function route() {
  const h = (location.hash || "#prospects").slice(1)
  if (h === "settings") { openSettings(); return }
  if (h === "handsoff") { openHandsoff(); return }
  if (h === "learned") { openLearned(); return }
  // Billing's header links here : the status sheet over the view you were on
  if (h === "status") { const go = () => (state.cage ? openCage() : setTimeout(go, 200)); go(); return }
  const was = state.view
  state.view = VIEWS.includes(h) ? h : h === "pipeline" ? "outreach" : "prospects"
  if (was !== state.view) window.scrollTo(0, 0)
  if (state.view !== "outreach" && !$("#lead").hidden) closeLead()
  for (const v of VIEWS) $(`#v-${v}`).hidden = state.view !== v
  $$("#steps a").forEach((a) => a.classList.toggle("on", a.dataset.v === state.view))
  if (state.view === "outreach") loadOutreach(); else state.boardFilter = null
  if (state.view === "prospects") loadProspects()
  if (state.view === "sites") loadSites()
}
window.addEventListener("hashchange", route)
function setMenu(open) { $("#menuDrop").hidden = !open; $("#menuBtn").setAttribute("aria-expanded", open ? "true" : "false") }
$("#menuBtn").onclick = (e) => { e.stopPropagation(); setMenu($("#menuDrop").hidden) }
document.addEventListener("click", () => setMenu(false))
// the menu answers the arrow keys (it says it is a menu) : down opens it on its first item, up / down move, Home / End
$("#menuBtn").addEventListener("keydown", (e) => { if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return; e.preventDefault(); setMenu(true); const items = $$("#menuDrop a"); (e.key === "ArrowDown" ? items[0] : items[items.length - 1]).focus() })
$("#menuDrop").addEventListener("keydown", (e) => {
  const items = $$("#menuDrop a"), i = items.indexOf(document.activeElement)
  const go = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key]
  if (go === undefined) return
  e.preventDefault(); items[(go + items.length) % items.length].focus()
})
$("#menuLearned").onclick = (e) => { e.preventDefault(); setMenu(false); openLearned() }
// a count that changes bumps once (the eye goes where something moved)
function setCount(sel, v) { const el = $(sel); if (el.textContent === v) return; const had = el.textContent !== ""; el.textContent = v; if (had && v) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump") } }
function renderCounts() {
  const p = state.prospectsData, sites = state.sites || []
  const waiting = sites.filter((x) => stateOf(x) === "new").length
  const n = { prospects: p ? p.counts.new : null, sites: sites.length ? waiting : null, outreach: state.outreachCount }
  const says = { prospects: (k) => `${k} new prospect${k === 1 ? "" : "s"} waiting for your decision`, sites: (k) => `${k} built site${k === 1 ? "" : "s"} waiting for your review`, outreach: (k) => `${k} call${k === 1 ? "" : "s"} to make` }
  for (const [v, k] of Object.entries(n)) {
    setCount(`#n${v[0].toUpperCase()}${v.slice(1)}`, k != null ? String(k) : "")
    const a = $(`#steps a[data-v="${v}"]`); a.classList.toggle("needs", !!k); a.title = k != null ? `${says[v](k)} (the number on each step is what needs you)` : ""
  }
  $("#handsoffChip").textContent = p && p.automatic ? "on" : "off"
}
/** the agency's name in the header and the tab (it is your cockpit) */
function renderBrand() { const nm = (state.agency && state.agency.name) || "Last Web Studios"; $("#brand span").textContent = nm; $("#brand").title = nm; document.title = nm; placeToasts() }
/** trades and the agency's locale arrive after the first paint : everything already on screen is written again with them
 *  (never « Cuisiniste » or « 51 25 55 01 26 » left from a render that came first) */
function rerender() { renderBrand(); if (state.prospectsData) renderProspects(); renderRail(); renderInspect(); if (state.crm) renderBoard(); if (state.lead) renderLead(); renderJobs() }

/* ───────── sheets ───────── */
let sheetOpener = null, lastFocus = null
document.addEventListener("focusin", (e) => { if (!e.target.closest("#sheet")) lastFocus = e.target })
const opener = () => (document.activeElement && document.activeElement !== document.body && !document.activeElement.closest("#sheet") ? document.activeElement : lastFocus)
function openSheet(title, html) { const sh = $("#sheet"); if (sh.hidden) sheetOpener = opener(); sh.setAttribute("aria-modal", "true"); sh.setAttribute("aria-label", title); $("#sheetTitle").textContent = title; $("#sheetBody").innerHTML = html; sh.classList.remove("wide", "learn"); const was = $("#sheet > .sheetfoot"); if (was) was.remove(); const foot = $("#sheetBody .sheetfoot"); if (foot) sh.appendChild(foot) /* a footer stays in view, outside the scroll */; sh.hidden = false; $("#scrim").hidden = false; const f = $("#sheet input:not([type=radio]):not([type=checkbox]), #sheet select, #sheet textarea, #sheet button.primary"); (f || $("#sheetClose")).focus() }
// the open dialog : a sheet above everything, else the call panel
const openDialog = () => (!$("#sheet").hidden ? $("#sheet") : !$("#lead").hidden ? $("#lead") : null)
// focus stays inside the open dialog (Tab cycles)
document.addEventListener("keydown", (e) => {
  const d = openDialog(); if (e.key !== "Tab" || !d) return
  const f = $$("button, input, select, textarea, summary, a[href], [tabindex='0']", d).filter((x) => !x.disabled && x.offsetParent !== null && !(x.type === "radio" && !x.checked && $$(`input[name="${x.name}"]:checked`, d).length))
  if (!f.length) return
  const first = f[0], last = f[f.length - 1]
  if (!d.contains(document.activeElement) || document.activeElement === d) { e.preventDefault(); (e.shiftKey ? last : first).focus() }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
})
// focus back on what opened it (a menu item that is gone → the menu button)
function refocus(el) { if (el && !el.isConnected && el.id) el = document.getElementById(el.id); if (!el || !el.isConnected) return; if (el.offsetParent === null && el.closest("#menuDrop")) el = $("#menuBtn"); if (el.offsetParent !== null) el.focus() }
let sheetOnClose = null
function closeSheet() { const was = !$("#sheet").hidden; $("#sheet").hidden = true; $("#scrim").hidden = true; $("#sheet").classList.remove("wide", "learn"); if (/#(settings|handsoff|status|learned)/.test(location.hash)) history.replaceState(null, "", "#" + state.view); const cb = sheetOnClose; sheetOnClose = null; if (cb) cb(); if (was) { const o = sheetOpener; sheetOpener = null; refocus(o) } }
/** an in-app confirmation, never the browser's confirm() / prompt() : resolves true / false, or the text typed (null =
 *  cancelled) when `input` names a field. Escape, the scrim and the close button cancel. */
function askSheet(title, text, o = {}) {
  return new Promise((resolve) => {
    let done = false
    const finish = (v) => { if (done) return; done = true; sheetOnClose = null; closeSheet(); resolve(v) }
    openSheet(title, `<span class="msg" id="askText">${esc(text)}</span>${o.input ? `<label class="field"><b>${esc(o.input)}</b><input id="askIn" type="text" maxlength="200" placeholder="${esc(o.placeholder || "")}"></label>` : ""}<div class="actions"><button class="btn ${o.danger ? "danger strong" : "primary"}" id="askOk">${esc(o.ok || "OK")}</button><button class="btn subtle" id="askNo">${esc(o.cancel || "Cancel")}</button></div>`)
    sheetOnClose = () => { if (!done) { done = true; resolve(o.input ? null : false) } }
    $("#askOk").onclick = () => finish(o.input ? ($("#askIn").value || "").trim() : true)
    $("#askNo").onclick = () => finish(o.input ? null : false)
    if (o.input) $("#askIn").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#askOk").click() } })
    else $("#askOk").focus()
  })
}
$("#scrim").onclick = closeSheet
$("#sheetClose").onclick = closeSheet
// Escape closes the top-most thing only : the menu, else the sheet, else the call panel
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return
  if (!$("#menuDrop").hidden) { setMenu(false); $("#menuBtn").focus(); return }
  if (!$("#sheet").hidden) { closeSheet(); return }
  if (!$("#lead").hidden) closeLead()
})
// keyboard : what acts like a button but is not one (cards, segments, tabs, the job strip) answers Enter and Space
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return
  const t = e.target; if (!t || !t.getAttribute || !/^(button|tab)$/.test(t.getAttribute("role") || "") || /^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
  e.preventDefault(); t.click()
})

// what each AI choice does, in plain words (building the sites always needs a Claude plan, said before you pick)
const AI = [["claude-code", "Claude subscription (Pro or Max)", "Builds the sites and runs everything, on the plan you already pay for."], ["codex", "ChatGPT subscription", "Runs the lighter steps only: building sites still needs a Claude plan (Pro or Max)."], ["anthropic", "Claude, paid per use", "No plan: you pay for what it uses. Builds the sites too."], ["openai-compatible", "Another model (on your computer or online)", "Runs the lighter steps only: building sites still needs a Claude plan (Pro or Max)."]]
const COUNTRIES = [["US", "United States", "en", "USD"], ["GB", "United Kingdom", "en", "GBP"], ["CA", "Canada", "en", "CAD"], ["AU", "Australia", "en", "AUD"], ["NZ", "New Zealand", "en", "NZD"], ["IE", "Ireland", "en", "EUR"], ["FR", "France", "fr", "EUR"], ["BE", "Belgium", "fr", "EUR"], ["CH", "Switzerland", "fr", "CHF"], ["DE", "Germany", "de", "EUR"], ["ES", "Spain", "es", "EUR"], ["IT", "Italy", "it", "EUR"], ["NL", "Netherlands", "nl", "EUR"]]
const COUNTRY_NAME = Object.fromEntries(COUNTRIES.map(([k, l]) => [k, l]))
const LANGS = [["en", "English"], ["fr", "French"], ["de", "German"], ["es", "Spanish"], ["it", "Italian"], ["nl", "Dutch"]]
const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF"]
const US_ZONES = [["America/New_York", "Eastern"], ["America/Chicago", "Central"], ["America/Denver", "Mountain"], ["America/Phoenix", "Arizona"], ["America/Los_Angeles", "Pacific"], ["America/Anchorage", "Alaska"], ["Pacific/Honolulu", "Hawaii"]]
const opts = (list, cur) => { const has = list.some(([k]) => k === cur); return (has || !cur ? list : [[cur, cur], ...list]).map(([k, l]) => `<option value="${esc(k)}" ${k === cur ? "selected" : ""}>${esc(l)}</option>`).join("") }
const code = (t) => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>")
/** the status of an AI choice : connected, or what it needs (the demo calls nothing but says what it would need) */
function aiLine(ai) {
  if (!ai || ai.error) return ""
  if (ai.demo) return `<span class="muted">Demo: the connection isn't checked (no AI is called).</span><br>For real: ${esc(ai.label)}. ${cmds(ai.fix || "")}${ai.builds ? ` ${cmds(ai.builds)}` : ""}`
  const head = ai.ok ? `${esc(ai.label || "Connected")}` : `${esc(ai.label || "")}${ai.fix ? `. ${cmds(ai.fix)}` : ""}`
  return ai.builds ? `${head}<br>${cmds(ai.builds)}` : head
}
/** a sentence whose `commands` become a command with its Copy button (plain words around them) */
const cmds = (t) => esc(t).replace(/`([^`]+)`/g, (_, c) => copyCmd(c.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")))
/** a command to copy, with its button (plain words around it, never a command alone in the middle of a sentence) */
const copyCmd = (cmd) => `<span class="cmd"><code>${esc(cmd)}</code><button type="button" class="btn subtle sm" data-copy="${esc(cmd)}">Copy</button></span>`
document.addEventListener("click", async (e) => { const b = e.target.closest && e.target.closest("[data-copy]"); if (!b) return; try { await navigator.clipboard.writeText(b.dataset.copy); toast("Copied") } catch { toast("Select the text to copy it", true) } })
/** the one line under the header while the agency is still the demo one (never a form wall over the product) ; on a
 *  phone it is one short line */
function renderDemoBar() {
  const st = state.settings, bar = $("#demoBar"); if (!bar || !st) return
  const key = st.sandbox ? "lws.demoBar.sandbox" : "lws.demoBar.real"
  let gone = false; try { gone = !!localStorage.getItem(key) } catch { /* */ }
  const show = (st.sandbox || st.demo) && !gone
  bar.hidden = !show; if (!show) return
  bar.innerHTML = st.sandbox
    ? `<span class="long">Demo agency: every business here is fictional and nothing is sent. What you change is thrown away when the demo stops.</span><span class="short">Demo agency · nothing is sent</span><a href="#settings" class="link">Settings</a><button type="button" class="btn icon quiet sm" id="demoBarX" aria-label="Hide this line">${IC.x}</button>`
    : `<span class="long">This is still the demo agency.</span><span class="short">Still the demo agency</span><a href="#settings" class="link">Make it yours</a><button type="button" class="btn icon quiet sm" id="demoBarX" aria-label="Hide this line">${IC.x}</button>`
  $("#demoBarX").onclick = () => { try { localStorage.setItem(key, "1") } catch { /* */ } bar.hidden = true }
}
/** your own cockpit with no AI to build the sites (Claude Code not signed in) : said on the main screen, before Find and
 *  Build, not only inside Settings */
async function renderAiBar() {
  const bar = $("#aiBar"); if (!bar || !state.settings || state.settings.sandbox) { if (bar) bar.hidden = true; return }
  const ai = await api("/api/ai-status?way=claude-code")
  if (!ai || ai.error || ai.ok) { bar.hidden = true; return }
  // installed : false only when the claude command is really missing ; installed but signed out → the sign-in line
  const missing = ai.way === "claude-code" && ai.installed === false
  bar.innerHTML = `<span>${missing ? "Claude Code isn't installed: sites can't be built yet. Install it in a terminal:" : "Claude isn't signed in on this computer: sites can't be built yet. Sign in once in a terminal:"}</span>${copyCmd(missing ? "curl -fsSL https://claude.ai/install.sh | bash" : "claude auth login")}`
  bar.hidden = false
}
// a US address's state → its time zone (Austin, TX → Central) ; the browser's zone when it is a US one
const STATE_TZ = { "America/New_York": "CT DE DC FL GA IN KY ME MD MA MI NH NJ NY NC OH PA RI SC VT VA WV", "America/Chicago": "AL AR IL IA KS LA MN MS MO NE ND OK SD TN TX WI", "America/Denver": "CO ID MT NM UT WY", "America/Phoenix": "AZ", "America/Los_Angeles": "CA NV OR WA", "America/Anchorage": "AK", "Pacific/Honolulu": "HI" }
const zoneOfAddress = (a) => { const st = (/,\s*([A-Z]{2})\s+\d{5}/.exec(String(a || "")) || [])[1]; return st ? (Object.entries(STATE_TZ).find(([, l]) => l.split(" ").includes(st)) || [])[0] || "" : "" }
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "" } catch { return "" } }
/** « “Hi, this is Camille from Atelier Vélin…” », in the language the scripts are said in */
function firstNameHint(name, agency, lang) {
  const n = name.trim() || "[your first name]", a = String(agency || "your agency").trim().replace(/[.\s]+$/, "")
  if (String(lang).startsWith("fr")) return `It signs your emails and opens your call scripts: “Bonjour, ici ${n}, ${/^[aeiouyéèêàâîôû]/i.test(a) ? "d'" : "de "}${a}…”`
  return `It signs your emails and opens your call scripts: “Hi, this is ${n} from ${a}…”`
}
/** French words left in what goes out in English (the demo's own paragraph, offer, promise) */
const looksFrench = (t) => /[éèêàçù]|\b(nous|vous|les|des|une|pour|avec|votre|site web|et le|et la)\b/i.test(String(t || ""))
async function openSettings(first = false) {
  const [st, agent, ai] = await Promise.all([api("/api/settings"), api("/api/agent"), api("/api/ai-status")])
  state.settings = st; state.agent = agent
  const isUS = (st.country || "") === "US"
  const left = (st.leftovers || []).filter((x) => x.key !== "name" || !st.demo)
  const demoAddr = left.some((x) => x.key === "postalAddress")
  const zone = US_ZONES.some(([k]) => k === st.timezone) && !demoAddr ? st.timezone : (zoneOfAddress(st.postalAddress) || (US_ZONES.some(([k]) => k === browserZone()) ? browserZone() : "America/New_York"))
  // the way already set (an unusual one too, e.g. a Messages-API server) stays selected : saving never switches it
  const aiNow = st.ai || "claude-code"
  const aiList = AI.some(([k]) => k === aiNow) ? AI : [...AI, [aiNow, "Another model", "Runs the lighter steps only: building sites still needs a Claude plan (Pro or Max)."]]
  openSheet(first || st.demo ? "Make it yours" : "Settings", `
    ${st.sandbox || st.demo || left.length ? `<span class="msg" id="sLeft">${st.sandbox ? "Demo: what you save here is thrown away when the demo stops." : st.demo ? "Still the demo agency: your name, your country and the AI you already pay for. One minute." : ""}${left.length ? ` Still the demo studio's: ${esc(left.map((x) => x.label.replace(/ \(.*\)$/, "").toLowerCase()).join(", "))}.` : ""}</span>` : ""}
    <section class="sgroup"><h3>Your agency</h3>
      <div class="sgrid">
        <label class="field"><b>Agency name</b><input id="sName" type="text" value="${esc(st.name || "")}" placeholder="Your studio" maxlength="80" aria-describedby="sNameErr"><span class="msg bad" id="sNameErr" role="alert"></span></label>
        <label class="field"><b>Your first name</b><input id="sFirst" type="text" value="${esc(st.firstName || "")}" placeholder="Your first name" maxlength="40" aria-describedby="sFirstHint"><span class="msg" id="sFirstHint"></span></label>
        <label class="field"><b>Country</b><select id="sCountry">${opts(COUNTRIES, String(st.country || "").toUpperCase())}</select></label>
        <label class="field"><b>Currency</b><select id="sCur">${opts(CURRENCIES.map((c) => [c, c]), String(st.currency || "").toUpperCase())}</select></label>
        <label class="field full"><b>Language of your emails and scripts</b><select id="sLang">${opts(LANGS, String(st.language || "").toLowerCase())}</select><span class="msg">The cockpit itself stays in English.</span></label>
      </div>
      <div id="sUSWrap" class="sgrid" ${isUS ? "" : "hidden"}>
        <label class="field"><b>Postal address</b><input id="sAddr" type="text" value="${esc(demoAddr ? "" : st.postalAddress || "")}" placeholder="Street, City, ST 12345" aria-describedby="sAddrErr sAddrHint"><span class="msg bad" id="sAddrErr" role="alert"></span><span class="msg" id="sAddrHint">Required on every email in the US (CAN-SPAM).</span></label>
        <label class="field"><b>Time zone</b><select id="sTz">${opts(US_ZONES, zone)}</select><span class="msg">Meetings are booked on this clock.</span></label>
      </div>
      <label class="field"><b>Describe your agency in one paragraph</b><textarea id="brandText" placeholder="Who you are, who you work with, what you promise." aria-describedby="brandErr brandHint">${esc(st.brand || "")}</textarea><span class="msg bad" id="brandErr" role="alert"></span><span class="msg" id="brandHint"></span></label>
    </section>
    <section class="sgroup"><h3>Your AI</h3>
      <label class="field"><b>Which AI do you use</b><select id="aiMode">${aiList.map(([k, l]) => `<option value="${k}" ${aiNow === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select><span class="msg" id="aiWhat"></span></label>
      <span class="msg ${ai && ai.ok && !ai.demo ? "ok" : ai && ai.demo ? "" : "bad"}" id="aiStatus" aria-live="polite">${aiLine(ai)}</span>
    </section>
    <section class="sgroup"><h3>When you approve a site</h3>${approveChoices(agent)}</section>
    <details class="adv sgroup" ${left.some((x) => ["phone", "contactEmail", "website", "offer", "guarantee"].includes(x.key)) ? "open" : ""}><summary>Details used in your emails</summary><div class="sgrid">
      <label class="field"><b>Phone</b><input id="sPhone" type="tel" value="${esc(st.phone || "")}"></label>
      <label class="field"><b>Email</b><input id="sMail" type="email" value="${esc(st.contactEmail || "")}" aria-describedby="sMailErr sMailHint"><span class="msg bad" id="sMailErr" role="alert"></span><span class="msg" id="sMailHint">Its domain becomes the name your mail server uses.</span></label>
      <label class="field"><b>Website</b><input id="sWeb" type="url" value="${esc(st.website || "")}" placeholder="https://your-studio.com" aria-describedby="sWebErr"><span class="msg bad" id="sWebErr" role="alert"></span></label>
      <label class="field full"><b>What you offer, in one line</b><textarea id="sOffer" rows="2" maxlength="400" class="grow">${esc(st.offer || "")}</textarea></label>
      <label class="field full"><b>Your promise, in one line</b><textarea id="sPromise" rows="2" maxlength="300" class="grow">${esc(st.guarantee || "")}</textarea></label>
    </div><span class="msg" id="sFrench" hidden></span></details>
    <div class="sheetfoot"><button class="btn primary" id="aSave">Save</button><button class="btn subtle" id="aCancel">${first ? "Later" : "Cancel"}</button><span class="msg bad" id="aMsg" role="alert"></span></div>`)
  $("#sheet").classList.add("wide")
  // the sentences grow with what you write (never cut off in a one-line box)
  for (const t of $$("#sheet textarea.grow")) { const fit = () => { t.style.height = "auto"; t.style.height = `${Math.max(64, t.scrollHeight + 2)}px` }; t.addEventListener("input", fit); requestAnimationFrame(fit) }
  wireRadios()
  // what the AI you pick does, and its status, before you save : connected, or the one thing to do
  const what = () => { const a = aiList.find(([k]) => k === $("#aiMode").value); $("#aiWhat").textContent = a ? a[2] : "" }
  what()
  $("#aiMode").addEventListener("change", async () => { what(); const v = $("#aiMode").value, el = $("#aiStatus"); el.className = "msg"; el.textContent = "Checking…"; const a = await api(`/api/ai-status?way=${enc(v)}`); if ($("#aiMode").value !== v) return; el.className = `msg ${a.ok && !a.demo ? "ok" : a.demo ? "" : "bad"}`; el.innerHTML = aiLine(a) })
  // the hints follow what you type and pick, live (your name in the script, the language, French left in English)
  const hint = () => {
    const l = $("#sLang").value
    $("#sFirstHint").textContent = firstNameHint($("#sFirst").value, $("#sName").value, l)
    $("#brandHint").textContent = `Used in the emails and the call scripts${LANG_NAME[l] && l !== "en" ? `, so write it in ${LANG_NAME[l]}: your emails go out in that language` : ""}.`
    const fr = l === "en" ? [["paragraph", $("#brandText").value], ["offer", $("#sOffer").value], ["promise", $("#sPromise").value]].filter(([, v]) => looksFrench(v)).map(([k]) => k) : []
    $("#sFrench").hidden = !fr.length; $("#sFrench").className = "msg bad"; $("#sFrench").textContent = fr.length ? `Your ${fr.join(", ")} still read${fr.length === 1 ? "s" : ""} like French: your emails go out in English.` : ""
    if (fr.includes("paragraph")) { $("#brandHint").textContent = "This reads like French: your emails go out in English. Write it in English."; $("#brandHint").className = "msg bad" } else $("#brandHint").className = "msg"
  }
  hint()
  for (const id of ["#sLang", "#sFirst", "#sName", "#brandText", "#sOffer", "#sPromise"]) $(id).addEventListener("input", hint)
  $("#sLang").onchange = hint
  let tzTouched = false
  $("#sTz").addEventListener("change", () => { tzTouched = true })
  $("#sAddr").addEventListener("input", () => { const z = zoneOfAddress($("#sAddr").value); if (z && !tzTouched) $("#sTz").value = z })
  // another country : the fields still holding the old demo studio's text get the new one's (never a field you wrote)
  let countryWas = String(st.country || "").toUpperCase()
  const DEMO_FIELDS = [["#sName", "name"], ["#sFirst", "firstName"], ["#brandText", "brand"], ["#sOffer", "offer"], ["#sPromise", "guarantee"], ["#sPhone", "phone"], ["#sMail", "contactEmail"], ["#sWeb", "website"]]
  $("#sCountry").onchange = () => {
    const now = $("#sCountry").value, c = COUNTRIES.find(([k]) => k === now)
    if (c) { $("#sLang").value = c[2]; $("#sCur").value = c[3] }
    const copy = st.demoCopy || {}, a = copy[countryWas], b = copy[now]
    if (a && b) for (const [sel, k] of DEMO_FIELDS) { const el = $(sel); if (el && a[k] && el.value.trim() === a[k].trim()) el.value = b[k] || "" }
    countryWas = now
    $("#sUSWrap").hidden = now !== "US"; hint()
  }
  // closing it in any way (Cancel, X, Escape, the scrim) counts as « later »
  $("#aCancel").onclick = closeSheet
  for (const [f, e] of [["#sName", "#sNameErr"], ["#brandText", "#brandErr"], ["#sAddr", "#sAddrErr"], ["#sMail", "#sMailErr"], ["#sWeb", "#sWebErr"]]) $(f).addEventListener("input", () => { $(e).textContent = ""; $(f).removeAttribute("aria-invalid") })
  const FIELD = { name: ["#sName", "#sNameErr"], brand: ["#brandText", "#brandErr"], postalAddress: ["#sAddr", "#sAddrErr"], contactEmail: ["#sMail", "#sMailErr"], website: ["#sWeb", "#sWebErr"] }
  const sayAt = (k, m) => { const [f, e] = FIELD[k] || []; if (!f) { $("#aMsg").textContent = m; return } if ($(f).closest("details")) $(f).closest("details").open = true; $(e).textContent = m; $(f).setAttribute("aria-invalid", "true"); $(f).focus() }
  $("#aSave").onclick = () => busy($("#aSave"), async () => {
    $("#aMsg").textContent = ""
    // what is missing is said next to the field, before anything is saved (the server checks the same)
    const us = $("#sCountry").value === "US"
    const missing = [["name", !$("#sName").value.trim(), "The agency needs a name."], ["brand", !$("#brandText").value.trim(), "This paragraph can't be empty: it goes in your emails."], ["postalAddress", us && !$("#sAddr").value.trim(), "A US agency needs a postal address: it goes in every email (CAN-SPAM)."], ["contactEmail", !!$("#sMail").value.trim() && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test($("#sMail").value.trim()), "That email doesn't look right."], ["website", !!$("#sWeb").value.trim() && !/^https?:\/\/\S+$/i.test($("#sWeb").value.trim()), "Your website must start with http(s)://"]].filter(([, bad]) => bad)
    if (missing.length) { for (const [k, , m] of missing.slice().reverse()) sayAt(k, m); return }
    if (badHook()) { $("#aMsg").textContent = HOOK_BAD; $("#aUrl").setAttribute("aria-invalid", "true"); $("#aUrl").focus(); return }
    const mode = ($("#modes input:checked, #sheet input[name=mode]:checked") || {}).value
    const a = await api("/api/agent", { mode, url: ($("#aUrl") || {}).value || "" })
    if (!a.ok) { $("#aMsg").textContent = a.error || "Not saved"; return }
    const r = await api("/api/settings", { name: $("#sName").value, firstName: $("#sFirst").value, country: $("#sCountry").value, language: $("#sLang").value, currency: $("#sCur").value, postalAddress: us ? $("#sAddr").value : undefined, timezone: us ? $("#sTz").value : undefined, brand: $("#brandText").value, phone: $("#sPhone").value, contactEmail: $("#sMail").value, website: $("#sWeb").value, offer: $("#sOffer").value, guarantee: $("#sPromise").value, ai: $("#aiMode").value })
    if (!r.ok) { if (r.field) sayAt(r.field, r.error); else $("#aMsg").textContent = r.error || "Not saved"; return }
    state.agent = a
    const [ag, st2] = await Promise.all([api("/api/agency"), api("/api/settings")]); state.agency = ag; state.settings = st2; setLocale(ag)
    closeSheet(); renderAgent(); renderDemoBar(); rerender(); setPlaceholder(); renderAiBar()
    const lower = (l) => l.map((x) => x.label.replace(/ \(.*\)$/, "").toLowerCase()).join(", ")
    const ph = r.placeholders && r.placeholders.length ? `${lower(r.placeholders)} on an .example address (a placeholder: it reaches nobody)` : ""
    toast(r.leftovers && r.leftovers.length ? `Saved. Still the demo's: ${lower(r.leftovers)}${ph ? `. Placeholders: ${ph}` : ""}` : ph ? `Saved. Placeholders: ${ph}` : "Saved")
    loadProspects(); loadSites(); if (state.view === "outreach") loadOutreach()
  })
}
const LANG_NAME = Object.fromEntries(LANGS)
/** « When you approve a site » : the call list, emails (test mode says so), and under Advanced your own tool */
function approveChoices(agent) {
  const test = !state.cage || state.cage.send.mode === "dry-run"
  const opt = (k, l, x) => `<label class="radio ${agent.mode === k ? "on" : ""}"><input type="radio" name="mode" value="${k}" ${agent.mode === k ? "checked" : ""}><b>${l}</b>${x ? `<span class="chip tag">${x}</span>` : ""}</label>`
  return `<div class="radios" id="modes">${opt("manual", "Add to my call list", "")}${opt("sequencer", "Send emails automatically", test ? "test mode" : "")}
    <details class="adv" ${agent.mode === "webhook" ? "open" : ""}><summary>Advanced</summary><div class="rows" style="margin-top:8px">${opt("webhook", "Send to my own tool", "")}<input id="aUrl" type="url" placeholder="https://your-tool.example/hook" value="${esc(agent.url || "")}" aria-label="Your tool's address"><span class="msg">When you approve a site, the business, its new site and the call script are sent to that address.</span></div></details></div>`
}
// your own tool's address, checked here first (the server checks it again)
const HOOK_BAD = "Your tool's address must start with http(s)://"
const badHook = () => ($("#modes input:checked") || {}).value === "webhook" && !/^https?:\/\/\S+$/i.test(($("#aUrl") || {}).value || "")
function wireRadios() { const u = $("#aUrl"); if (u) u.addEventListener("input", () => u.removeAttribute("aria-invalid")); $$("#sheet input[type=radio]").forEach((i) => i.addEventListener("change", () => { $$(`#sheet input[name="${i.name}"]`).forEach((r) => r.closest(".radio").classList.toggle("on", r.checked)) })) }
async function openApproveMode() {
  const agent = await api("/api/agent"); if (agent && agent.mode) state.agent = agent
  openSheet("When you approve a site", `${approveChoices(state.agent || { mode: "manual" })}
    <div class="actions"><button class="btn primary" id="mSave">Save</button><button class="btn subtle" id="mCancel">Cancel</button></div><span class="msg bad" id="mMsg" role="alert"></span>`)
  wireRadios()
  $("#mCancel").onclick = closeSheet
  $("#mSave").onclick = () => busy($("#mSave"), async () => {
    if (badHook()) { $("#mMsg").textContent = HOOK_BAD; $("#aUrl").setAttribute("aria-invalid", "true"); $("#aUrl").focus(); return }
    const a = await api("/api/agent", { mode: ($("#modes input:checked") || {}).value, url: ($("#aUrl") || {}).value || "" })
    if (!a.ok) { $("#mMsg").textContent = a.error || "Not saved"; if (/address/.test(a.error || "")) $("#aUrl").focus(); return }
    state.agent = a; closeSheet(); renderAgent(); toast("Saved")
  })
}
const HANDSOFF_ON = "New good prospects get built without asking you. You still approve each site."
/** Hands-off : what it does, what it spends, the daily limit it stays under (asked for first when there is none) */
async function openHandsoff() {
  // the real state, not the last list's copy (it may be a few hundred ms old right after a toggle)
  const [cur, pend0] = await Promise.all([api("/api/automatic"), api("/api/handsoff/pending")])
  const on = !!cur.automatic
  if (state.prospectsData) state.prospectsData.automatic = on
  const stopped = paused()
  const per = (pend0 && pend0.perSiteUsd) || 3, cap = pend0 ? pend0.buildsCap : null, done = (pend0 && pend0.buildsDone) || 0
  openSheet("Hands-off", `
    <span class="msg">When it is on, each new good prospect a search brings in your country gets its site built without asking you${cap != null ? `, up to ${cap} build${cap === 1 ? "" : "s"} a day (today: ${done} done)` : ""}. A build uses about ${usd(per)} of your plan: an estimate, not a charge. Nothing goes out on its own: every site still waits for your approval.</span>
    ${stopped ? `<span class="msg bad">Stopped: nothing is built until you resume (the status pill, top right).</span>` : ""}
    ${cap == null ? `<div class="field"><b>Daily cap first</b><span class="msg">Hands-off never builds without one. Past it, nothing new starts until tomorrow.</span><div class="inlinerow"><input id="hoCap" type="number" min="1" max="200" step="1" value="6" aria-label="Builds a day" aria-describedby="hoCapErr"><span class="muted">builds a day</span></div><span class="msg bad" id="hoCapErr" role="alert"></span></div>` : ""}
    <label class="switch"><input type="checkbox" id="hoToggle" ${on ? "checked" : ""}><span class="track"></span><span>Hands-off</span></label>
    <span class="msg" id="hoHint">${on ? HANDSOFF_ON : "Off: you decide each build."}</span>`)
  $("#hoToggle").onchange = async (e) => {
    const want = e.target.checked
    if (!want) { const r = await api("/api/automatic", { on: false }); if (r.automatic === false) { if (state.prospectsData) state.prospectsData.automatic = false; renderCounts(); toast(r.canceled ? `Hands-off is off: ${r.canceled} waiting build${r.canceled === 1 ? "" : "s"} cancelled` : "Hands-off is off"); $("#hoHint").textContent = "Off: you decide each build."; loadProspects(); loadJobs() } else { e.target.checked = true; toast(r.error || "Not saved", true) } return }
    // no daily limit yet : it is set first (never an unattended build without a ceiling)
    const capIn = $("#hoCap")
    if (capIn) {
      const v = Number(capIn.value)
      if (!(Number.isInteger(v) && v >= 1 && v <= 200)) { e.target.checked = false; $("#hoCapErr").textContent = "A daily cap between 1 and 200 builds."; capIn.setAttribute("aria-invalid", "true"); capIn.focus(); return }
      const b = await api("/api/budget", { buildsDay: v })
      if (!b.ok) { e.target.checked = false; $("#hoCapErr").textContent = b.error || "Not saved"; return }
      loadCage()
    }
    // on : say what happens now, with the count, what fits today and what is left aside, before anything is built
    const r = await api("/api/automatic", { on: true })
    if (r.automatic !== true) { e.target.checked = false; toast(r.error || "Not saved", true); return }
    if (state.prospectsData) state.prospectsData.automatic = true
    $("#hoHint").textContent = HANDSOFF_ON
    renderCounts()
    const pend = await api("/api/handsoff/pending")
    const n = pend.count || 0
    if (!n || paused()) { toast(paused() ? "Hands-off is on. Stopped: nothing is built until you resume" : "Hands-off is on"); if (!n) closeSheet(); return }
    // the counts are the server's : what is built now (today's cap) and what waits for tomorrow, never more
    const today = pend.today || 0, later = pend.later || 0
    const est = pend.simulated ? "The demo calls no AI." : today ? `About ${usd(pend.estimateUsd)} of plan usage today (an estimate, not a charge).` : ""
    const abroad = pend.abroad ? ` ${pend.abroad} more ${pend.abroad === 1 ? "is" : "are"} outside ${esc(COUNTRY_NAME[pend.country] || pend.country)}${pend.abroadPlaces && pend.abroadPlaces.length ? ` (${esc(pend.abroadPlaces.join("; "))})` : ""}: left for you to decide.` : ""
    const unreachable = pend.noContact ? ` ${pend.noContact} with no phone and no email ${pend.noContact === 1 ? "is" : "are"} left out.` : ""
    const fit = later ? ` Today's cap leaves room for ${today}; the other ${later} are built tomorrow, first in line.` : ""
    const go = today ? (later ? `Build ${today} now (today's cap), the rest tomorrow` : `Build ${today} now`) : `Build them tomorrow`
    openSheet("Hands-off is on", `<span class="msg"><b>${n}</b> good prospect${n === 1 ? "" : "s"} already wait.${fit} ${est}${abroad}${unreachable}</span><div class="actions"><button class="btn primary" id="hoGo">${go}</button><button class="btn ghost" id="hoSkip">Only new ones</button></div>`)
    $("#hoSkip").onclick = () => { closeSheet(); toast("Hands-off is on") }
    $("#hoGo").onclick = () => busy($("#hoGo"), async () => { const x = await api("/api/handsoff/run", { ids: pend.ids }); if (x.ok) { closeSheet(); toast(x.built ? `Building ${x.built} site${x.built === 1 ? "" : "s"}${x.later ? `; ${x.later} tomorrow` : ""}` : x.later ? `${x.later} will be built tomorrow` : "Nothing new to build"); loadJobs(); loadProspects() } else toast(x.error || "Could not start", true) })
  }
}
function openCage() {
  const c = state.cage; if (!c) return
  const b = c.breaker, n = (b && b.counts && b.counts.sends) || 0
  const cnt = (k) => (b && b.counts && b.counts[k]) || 0
  const th = (b && b.thresholds) || { bounceRate: 0.01, complaintRate: 0.001, unsubRate: 0.02 }
  const floor = (b && b.thresholds && b.thresholds.minSends) || 100
  const pc = (x) => `${Math.round(x * 1000) / 10}%`
  const test = c.send.mode === "dry-run", demo = !!(state.settings && state.settings.sandbox)
  // in test mode nothing is sent : the emails are « written » ; a rate is judged only from 100 emails, and a meter is
  // coloured only when its limit really applies
  const verb = test ? "written" : "sent", judged = n >= floor
  const rate = (k, lim) => { const v = n ? cnt(k) / n : 0; const over = judged && v > lim; return `<div class="meter row ${judged ? "" : "dim"} ${over ? "over" : ""}"><span class="k">${{ bounce: "Bounced emails", complaint: "Spam complaints", unsub: "Unsubscribes" }[k]}</span><b>${cnt(k)} of ${n} ${verb}</b></div>` }
  const used = c.budget.spentUsd || 0
  const bl = c.builds || { done: 0, cap: null, perBuildUsd: 3, estimateUsd: 0 }
  // the day in builds (what a subscriber understands) ; the plan usage is an estimate, never a price next to a cap
  openSheet(c.stop.on ? "Stopped" : test ? "Test mode — no emails go out" : "Live — emails go out", `
    ${c.stop.on ? `<span class="msg bad">${esc(c.stop.reason || "Stopped by you")}</span><span class="msg">Nothing new starts until you resume: no searches, no builds, no emails. A build that was running stops after the site it was on.</span>` : test ? `<span class="msg">Sites get built and your call list fills. Emails are written, never sent.</span>` : `<span class="msg">Approved sites get their emails for real, within the daily limits.</span>`}
    <div class="today rows">
      <div class="row big"><span class="k">Builds today</span><b>${bl.cap != null ? `${bl.done} of ${bl.cap}` : `${bl.done}`}</b></div>
      ${bl.cap ? `<span class="bar"><i class="${bl.reached ? "bad" : ""}" style="width:${Math.min(100, (bl.done / bl.cap) * 100)}%"></i></span>` : ""}
      <div class="row"><span class="k">Daily cap</span><b>${bl.reached || c.budget.reached ? `<span class="msg bad">reached: new builds wait for tomorrow</span>` : bl.cap != null ? `${bl.cap} build${bl.cap === 1 ? "" : "s"}${demo ? " (the demo's)" : ""}` : `<span class="msg">none set</span>`}</b></div>
      <div class="row"><span class="k">Plan usage today</span><b>${demo ? "none (the demo calls no AI)" : `≈ ${usd(Math.max(used, bl.estimateUsd || 0))}`}</b></div>
      <span class="msg">A build uses about ${usd(bl.perBuildUsd || 3)} of your plan: an estimate, not a charge.${bl.cap != null ? " Past the daily cap, new builds wait for tomorrow." : " With no daily cap, nothing stops a long run: set one in Hands-off."}</span>
    </div>
    ${b ? `<section class="sgroup"><h3>Emails</h3><div class="meters">${rate("bounce", th.bounceRate) + rate("complaint", th.complaintRate) + rate("unsub", th.unsubRate)}</div>
      ${b.open ? `<span class="msg bad">Safety limit reached: sending stopped.</span>` : ""}
      <span class="msg">${judged ? "" : `Not judged yet: these rates count from ${floor} emails ${verb} (${n} so far). `}Above ${pc(th.bounceRate)}&nbsp;bounces, ${pc(th.complaintRate)}&nbsp;spam complaints or ${pc(th.unsubRate)}&nbsp;unsubscribes over 7&nbsp;days, sending stops by itself.</span></section>` : ""}
    ${test && !c.stop.on ? `<details class="adv"><summary>Turn on sending</summary><span class="msg">Real emails are a step you take outside the cockpit, on purpose, so that no click can start them: your own domain and mailboxes warmed up first, then two switches in your server's settings. The step-by-step is in the README, “The cage” and “Going 24/7”.</span></details>` : ""}
    <div class="sheetfoot">
      ${b && b.open ? `<button class="btn quiet" id="cReset">Lift the safety limit</button>` : ""}
      <button class="btn ${c.stop.on ? "primary" : "danger strong"}" id="cStop">${c.stop.on ? "Resume" : "Stop"}</button>
    </div>`)
  $("#cStop").onclick = async () => {
    const on = !c.stop.on
    let reason = ""
    // the reason is asked in the cockpit's own sheet (never the browser's prompt) ; cancelling it does not stop
    if (on) { const p = await askSheet("Stop everything?", "Nothing new starts until you resume: no searches, no builds, no emails. A running build stops after the site it is on.", { input: "Reason (optional)", placeholder: "Checking the last builds", ok: "Stop", danger: true }); if (p === null) return; reason = p }
    const r = await api("/api/cage/stop", { on, reason })
    if (r.ok) { closeSheet(); loadCage() }
  }
  const rs = $("#cReset"); if (rs) rs.onclick = async () => { await api("/api/cage/breaker/reset"); closeSheet(); loadCage() }
}
function openStages() {
  const s = state.stages; if (!s) return
  const row = (x) => `<input type="text" data-k="${x.key}" value="${esc(x.label)}" maxlength="40" aria-label="Step name" aria-describedby="err-${x.key}"><span class="msg bad" id="err-${x.key}" role="alert"></span>`
  openSheet("Edit steps", `<span class="msg">Rename the columns of your board. The order stays.</span><div class="field"><b>Calls</b><div class="rows">${s.hot.map(row).join("")}</div></div><div class="field"><b>Deal</b><div class="rows">${s.closing.map(row).join("")}</div></div><div class="actions"><button class="btn primary" id="sSave">Save</button><button class="btn subtle" id="sCancel">Cancel</button></div><span class="msg bad" id="sMsg" role="alert"></span>`)
  $("#sCancel").onclick = closeSheet
  const mark = (i, bad) => { if (bad) i.setAttribute("aria-invalid", "true"); else i.removeAttribute("aria-invalid"); $(`#err-${i.dataset.k}`).textContent = bad ? "A step needs a name." : "" }
  $$("#sheet input[data-k]").forEach((i) => i.addEventListener("input", () => { if (i.value.trim()) mark(i, false) }))
  $("#sSave").onclick = () => busy($("#sSave"), async () => {
    const labels = {}, blank = []
    $$("#sheet input[data-k]").forEach((i) => { mark(i, !i.value.trim()); if (!i.value.trim()) blank.push(i); labels[i.dataset.k] = i.value.trim() })
    if (blank.length) { blank[0].focus(); return }
    const r = await api("/api/crm/stages", { labels })
    if (r.ok) { state.stages = { hot: r.hot, closing: r.closing }; closeSheet(); renderBoard(); toast("Saved") } else $("#sMsg").textContent = r.error || "Not saved"
  })
}
function openFilter() {
  const d = state.prospectsData; if (!d) return
  const f = state.filters
  openSheet("Filter", `
    <label class="field"><b>Trade</b><select id="fTrade"><option value="">All trades</option>${d.trades.map((t) => `<option value="${esc(t)}" ${f.trade === t ? "selected" : ""}>${esc(trade(t))}</option>`).join("")}</select></label>
    <label class="field"><b>City</b><select id="fCity"><option value="">All cities</option>${d.cities.map((c) => `<option value="${esc(c)}" ${f.city === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
    <label class="field"><b>Status</b><select id="fStatus"><option value="">All</option>${Object.entries(STATUS_P).map(([k, l]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <div class="actions"><button class="btn primary" id="fApply">Apply</button><button class="btn subtle" id="fClear">Clear</button></div>`)
  $("#fApply").onclick = () => { state.filters = { trade: $("#fTrade").value, city: $("#fCity").value, status: $("#fStatus").value }; closeSheet(); renderProspects() }
  $("#fClear").onclick = () => { state.filters = { trade: "", city: "", status: "" }; closeSheet(); renderProspects() }
}
$("#filterBtn").onclick = openFilter

/* ───────── site captures : their site today, the new one ───────── */
// a live render of a site when no capture of it was taken : laid out at 1440 × 900 and scaled to its box (never
// focusable, never clickable : the card around it is)
const liveRO = window.ResizeObserver ? new ResizeObserver((es) => { for (const e of es) { const f = e.target.firstElementChild; if (f && e.contentRect.width) f.style.transform = `scale(${e.contentRect.width / 1440})` } }) : null
function observeLive(root = document) { if (!liveRO) return; for (const el of $$(".live:not([data-o])", root)) { el.dataset.o = "1"; liveRO.observe(el) } }
const liveThumb = (src) => `<div class="live"><iframe title="" aria-hidden="true" tabindex="-1" loading="lazy" scrolling="no" src="${esc(src)}"></iframe></div>`
/** the new site of a business : its capture when one was taken, else the page itself, scaled */
function siteThumb(id, date) {
  const s = (state.sites || []).find((x) => x.id === id && (!date || x.date === date)) || null
  const d = date || (s && s.date); if (!d) return ""
  // a real build's capture (taken once its images loaded) ; a demo build is drawn live (always the version you see)
  return s && s.shot && !s.simulated ? `<img class="shot" src="/thumb/${enc(id)}/${enc(d)}" alt="" loading="lazy">` : liveThumb(`/preview/${enc(id)}/${enc(d)}/index.html`)
}
const oldThumb = (id) => `<img class="shot old" src="/avant/${enc(id)}" alt="" loading="lazy">`
// a wide capture of their old site (a real one, taken on a 1440 screen) is cropped to its middle ; the page itself
// (the demo's capture) or a drawing is never cropped (it would cut the name off)
document.addEventListener("load", (e) => { const t = e.target; if (t instanceof HTMLImageElement && t.classList.contains("old")) t.classList.toggle("wide", t.naturalWidth >= 1280 && !/\.svg/i.test(t.currentSrc || "")) }, true)

/* ───────── prospects ───────── */
// the FURTHEST state of a business, in the same words as the Sites rail (one business never has two statuses)
const STATUS_P = { new: "New", building: "Building", built: "Waiting for you", outreach: "In outreach", won: "Won", lost: "Lost", skipped: "Skipped" }
async function loadProspects() {
  const d = await api("/api/prospects")
  if (!d || !d.items) return
  state.prospectsData = d
  // no database : said on load, once, at the top (not again under the field and in the list)
  if (d.noDb && !serverGone && !d.sandbox) { $("#banner").innerHTML = `<span>${code(d.noDbWhy || "No database: finding prospects needs one.")} Your built sites still show.</span>`; $("#banner").hidden = false }
  if (typeof d.toCall === "number" && state.view !== "outreach") state.outreachCount = d.toCall
  renderProspects(); renderCounts(); renderFindState()
}
/** the progress of a build, on the business itself : the lime line sweeps down their old site */
function buildProgress(id) {
  const live = [...jobs.live.values()].find((j) => j.mode === "composer" && j.status !== "done" && ((j.ids || []).includes(id) || ((j.params || {}).ids || []).includes(id)) && !(j.done || []).includes(id))
  const row = live || [...jobs.rows.values()].find((j) => j.mode === "composer" && ["queued", "running"].includes(j.status) && ((j.params || {}).ids || []).includes(id))
  const ids = (row && ((row.ids) || (row.params || {}).ids)) || []
  const queued = !row || row.status === "queued" || buildState(id) === "queued"
  const pct = !queued && row && typeof row.pct === "number" ? (ids.length <= 1 ? row.pct : Math.min(95, ((row.pct / 100) * ids.length - ids.indexOf(id)) * 100)) : null
  return { queued, pct: pct != null ? Math.max(4, Math.min(100, pct)) : null }
}
function paintBuilding() {
  for (const el of $$("#plist .pc.building")) {
    const g = buildProgress(el.dataset.id), th = el.querySelector(".thumb"), chip = el.querySelector("[data-prog]"); if (!th || !chip) continue
    th.style.setProperty("--p", g.queued ? "0%" : `${g.pct != null ? g.pct : 30}%`)
    th.classList.toggle("indet", !g.queued && g.pct == null); th.classList.toggle("queued", g.queued)
    chip.textContent = g.queued ? (jobs.paused ? "Paused" : "Waiting its turn") : g.pct != null ? `Building · ${Math.round(g.pct)}%` : "Building"
  }
}
function prospectCard(x, sel) {
  // their site today (or, once built, the new one) as the hero ; who it is and its status ; why it fits ; who to call
  // and the one action
  const hasSite = ["built", "outreach", "won", "lost"].includes(x.status) && x.site
  const thumb = hasSite ? siteThumb(x.id, x.site.date) : x.hasBefore ? oldThumb(x.id) : `<span class="nopic">No capture</span>`
  const building = x.status === "building"
  const contact = x.phone ? `<span class="tel">${esc(fmtPhone(x.phone))}</span>${x.email ? `<span class="em" title="An email address too">${IC.mail}<span class="sr">and an email address</span></span>` : ""}` : `<span class="${x.email ? "" : "noreach"}">${x.email ? "Email only, no phone" : "No phone, no email"}</span>`
  const over = hasSite ? `<span class="over bl">The new site</span>` : building ? `<span class="veil"></span><span class="scan"></span><span class="over bl" data-prog>Building</span>` : x.oldUrl ? `<a class="over tr hov" href="${esc(x.oldHref || x.oldUrl)}" target="_blank" rel="noopener" title="Their site today, in a new tab">${IC.ext}Their site</a>` : ""
  const why = x.reasons.slice(0, 2)
  return `<div class="thumb" ${hasSite ? `data-open="${esc(x.id)}" title="See the new site"` : ""}>${thumb}${over}${x.status === "new" ? `<input type="checkbox" data-sel="${esc(x.id)}" ${sel.has(x.id) ? "checked" : ""} aria-label="Select ${esc(x.name)}">` : ""}</div>
      <div class="head"><div class="ttl"><div class="name">${esc(x.name)}</div><div class="sub">${esc([trade(x.industry), place(x.city, x.region, x.zip)].filter(Boolean).join(" · "))}</div></div><span class="chip status ${x.status}">${STATUS_P[x.status]}</span></div>
      ${x.strong || why.length ? `<div class="tags">${x.strong ? `<span class="chip fit" title="Many problems on their site: the new one changes the most">Strong fit</span>` : ""}${why.map((r) => `<span class="chip tag">${esc(r)}</span>`).join("")}${x.reasons.length > 2 ? `<span class="chip tag" title="${esc(x.reasons.slice(2).join(", "))}">+${x.reasons.length - 2}</span>` : ""}</div>` : ""}
      <div class="foot">
        <span class="contact">${contact}</span>
        ${x.status === "new" ? `<button class="btn quiet" data-skip="${esc(x.id)}">Skip</button><button class="btn build" data-build="${esc(x.id)}" ${paused() ? `disabled title="${PAUSED}"` : ""}>Build site</button>` : ""}
        ${hasSite ? `<a class="btn quiet" href="#sites" data-open="${esc(x.id)}">See the site</a>` : ""}
        ${x.status === "skipped" ? `<button class="btn quiet" data-unskip="${esc(x.id)}">Undo</button>` : ""}
      </div>`
}
const listBusy = () => !!(state.pointerInList || (state.psel && state.psel.size) || ($("#plist") && $("#plist").contains(document.activeElement) && document.activeElement !== $("#plist")))
// the order of the list : what needs a decision first, then what is already moving, then what you skipped
const GROUP = { new: 0, building: 0, built: 1, outreach: 1, won: 1, lost: 1, skipped: 2 }
const GROUP_HEAD = [null, "Already built", "Skipped"]
/** the head of the list : what it is, in a sentence ; why these, in a sentence ; the trades */
function renderProspectHead(items) {
  const d = state.prospectsData; if (!d || !$("#pHead")) return
  items = items || state.shownItems || d.items
  const n = items.filter((x) => x.status === "new").length
  $("#pHead").textContent = !d.items.length ? (d.noDb ? "No database here yet" : "Find your first prospects") : n ? `${n} business${n === 1 ? "" : "es"} could use a new site` : "Nothing new to decide"
  const pick = state.learning && state.learning.picks && state.learning.picks.items && state.learning.picks.items[0]
  const lede = !d.items.length ? "" : pick ? esc(pick.sentence.replace(/\.?$/, ".")) : "Local businesses with a dated site and a way to reach them."
  $("#pLede").innerHTML = lede ? `${lede} <button type="button" class="link linkbtn" id="howPicks">How the agency picks</button>` : ""
  const hp = $("#howPicks"); if (hp) hp.onclick = () => openLearned("picks")
  const bl = state.cage && state.cage.builds
  const f = state.filters, nf = [f.trade, f.city, f.status].filter(Boolean).length
  const newShown = items.filter((x) => x.status === "new").length
  const statusWord = f.status ? (STATUS_P[f.status] || f.status).toLowerCase() : ""
  $("#pCount").textContent = !d.items.length ? "" : !items.length && nf ? `No ${statusWord ? `${statusWord} ` : ""}prospects${f.trade || f.city ? " here" : ""} (of ${d.items.length})` : `${items.length} prospect${items.length === 1 ? "" : "s"}${nf ? ` (of ${d.items.length})` : ""} · ${newShown} new${state.heldCount ? ` · ${state.heldCount} more waiting` : ""}`
  // today's builds : a wide screen only (on a phone the status pill already says it, and the line must stay one line)
  $("#pBuilds").textContent = d.items.length && items.length && bl && bl.cap != null ? ` · ${bl.done} of ${bl.cap} builds today` : ""
  // the trades as one segmented control, with neutral counts (only when there is a choice)
  const counts = {}; for (const x of d.items) if (x.industry) counts[x.industry] = (counts[x.industry] || 0) + 1
  const trades = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
  const seg = $("#pseg")
  seg.hidden = trades.length < 2
  if (trades.length >= 2) {
    const html = [`<button type="button" data-tr="" class="${f.trade ? "" : "on"}" aria-pressed="${f.trade ? "false" : "true"}">All <span class="n">${d.items.length}</span></button>`, ...trades.map((t) => `<button type="button" data-tr="${esc(t)}" class="${f.trade === t ? "on" : ""}" aria-pressed="${f.trade === t ? "true" : "false"}">${esc(tradePlural(trade(t)).replace(/^./, (c) => c.toUpperCase()))} <span class="n">${counts[t]}</span></button>`)].join("")
    if (seg.dataset.sig !== html) { seg.innerHTML = html; seg.dataset.sig = html; $$("#pseg [data-tr]").forEach((b) => b.onclick = () => { state.filters.trade = b.dataset.tr; renderProspects() }) }
  }
}
function renderProspects() {
  const d = state.prospectsData; if (!d) return
  const f = state.filters
  let items = d.items.filter((x) => (!f.trade || x.industry === f.trade) && (!f.city || x.city === f.city) && (!f.status || x.status === f.status))
  // cards arriving while you point at, select or tab through the list wait above it : nothing moves under a click
  const shown = state.knownIds
  const held = shown && shown.size && listBusy() ? items.filter((x) => !shown.has(x.id)) : []
  if (held.length) items = items.filter((x) => shown.has(x.id))
  state.heldCount = held.length; state.shownItems = items
  const pill = $("#newPill")
  if (pill) { pill.hidden = !held.length; pill.innerHTML = held.length ? `${held.length} new prospect${held.length === 1 ? "" : "s"} <span class="link">Show</span>` : "" }
  const sel = state.psel || new Set()
  const list = $("#plist")
  const nf = [f.city, f.status].filter(Boolean).length
  $("#filterCount").textContent = nf ? String(nf) : ""; $("#filterCount").hidden = !nf
  renderProspectHead(items)
  if (!items.length) {
    list.innerHTML = d.items.length ? `<div class="empty">Nothing matches these filters. <button type="button" class="btn sm" id="clearFilters">Clear filters</button></div>` : d.noDb ? `<div class="hero"><span>Your built sites still show in Sites.</span></div>` : `<div class="hero"><b>Tell the agency what you're after</b><span>It finds local businesses with a dated website: a trade, a place, how many — or “surprise me”.</span><div class="howto"><div><b>Prospects</b>You say what you're after; it finds businesses with a dated site and tells you why each one fits.</div><div><b>Sites</b>It rebuilds their site; you review it and send the good ones to outreach.</div><div><b>Outreach</b>Emails go out, you call with the new site in hand, deals move step by step.</div></div></div>`
    const cf = $("#clearFilters"); if (cf) cf.onclick = () => { state.filters = { trade: "", city: "", status: "" }; renderProspects() }
    state.knownIds = new Set(); renderBulk(); renderFindState(); return
  }
  if (list.querySelector(".empty, .hero")) list.innerHTML = ""
  // the nodes in order : the cards of each group, a heading before the groups after the first
  items = items.map((x, i) => [x, i]).sort((a, b) => GROUP[a[0].status] - GROUP[b[0].status] || a[1] - b[1]).map(([x]) => x)
  const nodes = []; let g = -1
  for (const x of items) {
    const gx = GROUP[x.status]
    if (gx !== g) { g = gx; if (GROUP_HEAD[g] && nodes.length) { const k = items.filter((y) => GROUP[y.status] === g).length; nodes.push({ key: `§${g}`, head: `${GROUP_HEAD[g]} <span>${k}</span>` }) } }
    nodes.push({ key: x.id, x })
  }
  const keep = new Set(nodes.map((n) => n.key))
  for (const el of [...list.children]) if (!keep.has(el.dataset.id)) el.remove()
  let prev = null
  for (const n of nodes) {
    let el = list.querySelector(`[data-id="${CSS.escape(n.key)}"]`)
    if (n.head) {
      if (!el) { el = document.createElement("h2"); el.dataset.id = n.key }
      if (el.innerHTML !== n.head) el.innerHTML = n.head
    } else {
      const x = n.x, html = prospectCard(x, sel), cls = `pc ${x.status} ${sel.has(x.id) ? "sel" : ""}`
      if (!el) { el = document.createElement("article"); el.dataset.id = x.id; el.tabIndex = -1; el.className = cls + (state.knownIds ? " chip enter" : ""); el.classList.remove("chip"); el.innerHTML = html; el.dataset.sig = html }
      else if (el.dataset.sig !== html) { el.innerHTML = html; el.dataset.sig = html; el.className = cls }
      else el.className = cls
    }
    if (prev ? prev.nextSibling !== el : list.firstChild !== el) list.insertBefore(el, prev ? prev.nextSibling : list.firstChild)
    prev = el
  }
  state.knownIds = new Set(items.map((x) => x.id))
  observeLive(list); paintBuilding()
  renderBulk()
}
$("#plist").addEventListener("click", (e) => {
  const b = e.target.closest("[data-build],[data-skip],[data-unskip],[data-open]"); if (!b) return
  if (b.dataset.build) buildIds([b.dataset.build], b)
  else if (b.dataset.skip) { const id = b.dataset.skip; busy(b, async () => { const r = await api("/api/prospects/skip", { id, on: true }); if (r.ok) toast(`Skipped ${siteNameOf(id)}`, false, { undo: async () => { await api("/api/prospects/skip", { id, on: false }); await loadProspects() } }); else toast(r.error || "Not saved", true); await loadProspects(); focusCard(id) }) }
  else if (b.dataset.unskip) { const id = b.dataset.unskip; busy(b, async () => { await api("/api/prospects/skip", { id, on: false }); await loadProspects(); focusCard(id) }) }
  else if (b.dataset.open) { state.openId = b.dataset.open; if (b.tagName !== "A") location.hash = "#sites" }
})
/** after an action re-draws a card, the keyboard stays on it : its first action, else the card */
function focusCard(id) { requestAnimationFrame(() => { const c = $(`#plist .pc[data-id="${CSS.escape(id)}"]`); if (!c) return; const b = c.querySelector(".foot button:not(:disabled), .foot a"); (b || c).focus({ preventScroll: true }) }) }
$("#plist").addEventListener("mouseenter", () => { state.pointerInList = true })
$("#plist").addEventListener("mouseleave", () => { state.pointerInList = false; if (!listBusy()) renderProspects() })
$("#newPill").onclick = () => { state.pointerInList = false; state.psel = new Set(); if ($("#plist").contains(document.activeElement)) document.activeElement.blur(); renderProspects(); window.scrollTo({ top: 0, behavior: "smooth" }) }
$("#selectMode").onclick = () => { const on = !$("#plist").classList.contains("selecting"); $("#plist").classList.toggle("selecting", on); $("#selectMode").setAttribute("aria-pressed", on ? "true" : "false"); $("#selectMode").textContent = on ? "Done" : "Select" }
$("#plist").addEventListener("change", (e) => {
  const c = e.target.closest("[data-sel]"); if (!c) return
  const sel = state.psel || new Set(); if (c.checked) sel.add(c.dataset.sel); else sel.delete(c.dataset.sel); state.psel = sel; renderBulk(); c.closest(".pc").classList.toggle("sel", c.checked)
})
function renderBulk() { const n = (state.psel || new Set()).size; $("#bulk").hidden = !n; $("#bulkCount").textContent = `${n} selected`; const fb = $("#findBtn"); if (fb) { fb.classList.toggle("primary", !n); fb.classList.toggle("subtle", !!n) } }
async function buildIds(ids, btn) {
  return busy(btn, async () => {
    const r = await api("/api/batch", { mode: "composer", ids, limit: ids.length, note: "from Prospects" })
    if (!r.ok) { toast(r.error || "Could not start the build", true); return }
    toast(r.tomorrow ? `${r.today ? `Building ${r.today} today` : "Nothing more today"}; ${r.tomorrow} tomorrow (today's cap: ${r.buildsCap} builds)` : ids.length === 1 ? `Building ${siteNameOf(ids[0])}: it shows up in Sites when it's ready` : `Building ${ids.length} sites`)
    for (const id of ids) { const it = state.prospectsData && state.prospectsData.items.find((x) => x.id === id); if (it) it.status = "building" }
    state.psel = new Set(); renderProspects(); renderCounts(); loadJobs(); loadBatches(); loadCage()
    if (ids.length === 1) focusCard(ids[0])
  })
}
$("#bulkBuild").onclick = (e) => buildIds([...(state.psel || [])], e.currentTarget)
// Clear unticks every box on screen too (a card whose HTML did not change keeps its DOM state otherwise)
$("#bulkClear").onclick = () => { state.psel = new Set(); $$("#plist .pc input[data-sel]").forEach((i) => { i.checked = false; i.closest(".pc").classList.remove("sel") }); renderProspects() }

const BRIEF = { timer: null }
const agencyCountry = () => String((state.agency && state.agency.country) || "").toUpperCase()
function renderBrief(b, text = $("#findText").value.trim()) {
  const box = $("#briefChips"); if (!b) { box.hidden = true; box.innerHTML = ""; delete box.dataset.brief; delete box.dataset.text; return }
  box.classList.remove("stale")
  if (b.error) { box.innerHTML = `<span class="msg bad">${esc(b.error)}</span>`; box.hidden = false; delete box.dataset.brief; box.dataset.text = text; return }
  const chip = (t, k, v) => `<span class="chip brief enter" data-rm="${k}" data-v="${esc(v || "")}">${esc(t)}<button type="button" class="x" aria-label="Remove ${esc(t)}" title="Remove">${IC.x}</button></span>`
  const elsewhere = b.country && agencyCountry() && b.country !== agencyCountry()
  const where = b.place ? `${b.place}${elsewhere && !/,\s*[A-Z]{2}$/.test(b.place) ? `, ${COUNTRY_NAME[b.country] || b.country}` : ""}` : ""
  const chips = [...(b.trades || []).map((t) => chip(trade(t), "trade", t)), where ? chip(where, "place") : (b.country && elsewhere ? chip(COUNTRY_NAME[b.country] || b.country, "country") : ""), chip(`${b.count} prospect${b.count === 1 ? "" : "s"}`, "count"), b.mix && !(b.trades || []).length ? chip("Mixed trades", "mix") : ""].filter(Boolean)
  const unknown = (b.unmatched || []).length ? ` <span class="muted">· ${esc(b.unmatched.join(", "))}: not a trade the agency knows yet</span>` : ""
  // a search outside the agency's country is said, so a wrong town never passes for a right one
  const other = elsewhere ? ` <span class="muted" id="briefWhere">· ${esc((b.place || "").replace(/,.*$/, "") || "That")} is in ${esc(COUNTRY_NAME[b.country] || b.country)}, not ${esc(COUNTRY_NAME[agencyCountry()] || agencyCountry())} (your agency's country): the search runs there.</span>` : ""
  const note = b.note ? ` <span class="muted" id="briefNote">· ${esc(b.note)}.</span>` : ""
  box.innerHTML = `<span>The agency understood:</span> ${chips.join(" ")} <button type="button" class="linkbtn editlink" id="briefEdit">${IC.pencil}Edit</button>${unknown}${other}${note}`
  box.hidden = false
  box.dataset.brief = JSON.stringify(b); box.dataset.text = text
  $("#briefEdit").onclick = () => openBriefEdit(b)
  $$("#briefChips .chip .x").forEach((x) => x.onclick = () => { const c = x.parentElement, nb = { ...b }; if (c.dataset.rm === "trade") nb.trades = (b.trades || []).filter((t) => t !== c.dataset.v); if (c.dataset.rm === "place") nb.place = ""; if (c.dataset.rm === "mix") nb.mix = false; if (c.dataset.rm === "count") nb.count = 10; renderBrief(nb, text) })
}
function openBriefEdit(b) {
  openSheet("What to look for", `
    <label class="field"><b>Trades</b><input id="eTrades" type="text" value="${esc((b.trades || []).map(trade).join(", "))}" placeholder="comma separated"></label>
    <label class="field"><b>Where</b><input id="ePlace" type="text" value="${esc(b.place || "")}"></label>
    <label class="field"><b>Country</b><select id="eCountry">${opts(COUNTRIES, String(b.country || agencyCountry() || "").toUpperCase())}</select></label>
    <label class="field"><b>How many</b><input id="eCount" type="number" min="1" max="200" value="${b.count || 10}"></label>
    <div class="actions"><button class="btn primary" id="eGo">Find</button><button class="btn subtle" id="eCancel">Cancel</button></div>`)
  $("#eCancel").onclick = closeSheet
  $("#eGo").onclick = () => busy($("#eGo"), async () => {
    const names = $("#eTrades").value.split(",").map((x) => x.trim()).filter(Boolean)
    const keys = names.map((n) => Object.entries(TRADE).find(([k, v]) => v.toLowerCase() === n.toLowerCase() || k === n.toLowerCase())?.[0])
    const bad = names.filter((n, i) => !keys[i])
    if (bad.length) { toast(`${bad.join(", ")}: not a trade the agency knows`, true); return }
    const cnt = Number($("#eCount").value) || 10
    if (cnt > 200) { toast("Max 200 per search", true); return }
    closeSheet()
    await startFind({ trades: keys, place: $("#ePlace").value.trim(), country: $("#eCountry").value.trim().toUpperCase(), count: Number($("#eCount").value) || 10, mix: !keys.length })
  })
}
async function startFind(payload) {
  if (paused()) { toast(PAUSED); return }
  $("#findDone").hidden = true
  // the row shows at once (« waiting its turn »), the server's id replaces it when it answers
  const tmp = -Date.now()
  jobs.rows.set(tmp, { id: tmp, mode: "find", status: "queued", params: payload.trades ? payload : (BRIEF.last || {}) }); renderJobs()
  const r = await api("/api/prospects/find", payload)
  jobs.rows.delete(tmp); renderJobs()
  if (!r.ok) { if (r.brief && r.brief.error) renderBrief(r.brief); else if (r.noDb) { $("#banner").innerHTML = code(r.error); $("#banner").hidden = false } else toast(r.error || "Could not start", true); return }
  renderBrief(r.brief)
  if (r.duplicate) { toast("Already looking for that"); loadJobs(); return }
  // one search at a time : a second one waits its turn, and says so
  const busyFind = [...jobs.rows.values()].some((j) => j.mode === "find" && j.status === "running" && j.id !== r.id)
  toast(busyFind ? "Queued: it starts when the current search ends" : "Looking for prospects")
  jobs.rows.set(r.id, { id: r.id, mode: "find", status: "queued", params: r.brief }); renderJobs(); loadJobs()
}
// the live preview: what the agency understood, as you type (the free parser, never a model)
async function previewBrief(text) { const b = await api("/api/brief", { text }); if (b && b.trades) { BRIEF.text = text; BRIEF.last = b } return b }
$("#findText").addEventListener("input", () => {
  clearTimeout(BRIEF.timer); const text = $("#findText").value.trim(); if (!text) { BRIEF.text = ""; renderBrief(null); return }
  // the chips under the field belong to the text they were read from : another text dims them at once (never old chips under new words)
  const box = $("#briefChips"); if (box.dataset.text !== text) box.classList.add("stale")
  BRIEF.timer = setTimeout(async () => { const b = await previewBrief(text); if (b && (b.trades || b.error) && $("#findText").value.trim() === text) renderBrief(b, text) }, 400)
})
// Enter while stopped (or with no database) : the disabled button would swallow it silently ; it is said next to the field
$("#findText").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return
  if (paused()) { e.preventDefault(); toast(PAUSED); renderFindState(); return }
  if (state.prospectsData && state.prospectsData.noDb) { e.preventDefault(); state.noDbAsked = true; renderFindState() }
})
$("#findForm").onsubmit = (e) => {
  e.preventDefault(); const text = $("#findText").value.trim()
  // an empty Find says what to type (never a click that does nothing)
  if (!text) { const n = $("#findNote"); n.hidden = false; n.textContent = "Type a trade and a place, like “roofers around Austin”, or “surprise me”."; $("#findText").focus(); return }
  if (!paused()) renderFindState()
  if (paused()) { toast(PAUSED); return }
  busy($("#findBtn"), async () => {
    // the reading of exactly this text (the preview may lag 400 ms) : not understood → said inline, nothing is sent
    clearTimeout(BRIEF.timer)
    const b = BRIEF.text === text && BRIEF.last ? BRIEF.last : await previewBrief(text)
    if (!b || b.gone) return
    if (b.error) { renderBrief(b); $("#findText").focus(); return }
    // the chips are used only when they were read from THIS text (you may have removed one) ; else this text's reading
    const box = $("#briefChips")
    const mine = box.dataset.text === text && box.dataset.brief
    if (!mine) renderBrief(b, text)
    const edited = box.dataset.text === text && box.dataset.brief ? JSON.parse(box.dataset.brief) : null
    await startFind(edited && (edited.trades || []).length ? { ...edited, brief: text } : { text })
  })
}
function setPlaceholder() {
  const keys = Object.keys(TRADE)
  const pick = (k) => (TRADE[k] || "").toLowerCase().replace(/ \/.*$/, "").split(" / ")[0]
  const a = keys.find((k) => /couvreur|roof/.test(k + TRADE[k])) || keys[0], b = keys.find((k) => /piscin|pool/.test(k + TRADE[k])) || keys[1]
  const us = state.agency && state.agency.country === "US"
  const where = us ? "around Austin" : "near Lyon"
  // a phone gets the one example that fits the field
  const narrow = window.matchMedia && matchMedia("(max-width: 640px)").matches
  $("#findText").placeholder = a && b ? (narrow ? `Try “20 ${pick(a)}s ${where}”` : `Tell the agency what you're after, like “20 ${pick(a)}s and ${pick(b)}s ${where}” or “surprise me”`) : "Tell the agency what you're after"
}
if (window.matchMedia) { const mq = matchMedia("(max-width: 640px)"); if (mq.addEventListener) mq.addEventListener("change", setPlaceholder) }

/* ───────── status pill ───────── */
async function loadCage() { const c = await api("/api/cage"); if (c && c.stop) renderCage(c) }
function renderCage(c) {
  state.cage = c
  if (state.agent && $("#agentLine").innerHTML) renderAgent()
  jobs.paused = !!c.stop.on; renderJobs() // waiting jobs say « paused » at once
  renderPaused()
  const p = $("#cagePill")
  const test = c.send.mode === "dry-run"
  p.className = "pill" + (c.stop.on ? " stop" : c.alerts && c.alerts.length ? " warn" : test ? " off" : "")
  // « ● Running » (D2) ; the day in builds next to it on a wide screen, never dollars next to a plan's price
  const word = c.stop.on ? "Stopped" : "Running"
  const bl = c.builds || { done: 0, cap: null }
  const builds = bl.cap != null ? `${bl.done} of ${bl.cap} builds today` : `${bl.done} build${bl.done === 1 ? "" : "s"} today`
  const full = `${c.stop.on ? "Stopped — nothing runs until you resume" : `Running. ${test ? "Test mode — no emails go out" : "Live — emails go out"}`}. ${builds}${bl.cap != null ? " (the daily cap)" : ""}.`
  p.title = full; p.setAttribute("aria-label", full)
  p.innerHTML = `<span class="dot"></span><span class="label">${word}</span><span class="short" aria-hidden="true">${word}</span>${c.stop.on ? "" : `<span class="label2">${builds}</span>`}`
  renderProspectHead()
}
$("#cagePill").onclick = openCage

/* ───────── sites ───────── */
async function loadSites() {
  const [sites, leads] = await Promise.all([api("/api/sites"), api("/api/leads")])
  state.sites = Array.isArray(sites) ? sites : []
  $("#v-sites").classList.toggle("nosites", !state.sites.length && !buildingOnly().length)
  state.leads = {}; for (const p of (leads && leads.prospects) || []) state.leads[p.id] = p
  renderRail()
  const visible = state.sites.filter((s) => s.hasIndex !== false)
  if (!state.sel && visible.length) selectSite(visible.find((x) => x.id === state.lastBuilt) || visible.find((x) => stateOf(x) === "new") || visible[0])
  if (state.openId) { const o = state.sites.find((s) => s.id === state.openId); state.openId = null; if (o) selectSite(o) }
  if (state.sel) {
    // a site that was building is now built : its preview is loaded (never a blank frame left from the building state)
    const cur = state.sites.find((s) => s.id === state.sel.id && (s.date === state.sel.date || state.sel.pending))
    if (cur) { const blank = /about:blank$/.test($("#preview").src || ""); state.sel = cur; if (blank && stateOf(cur) !== "building" && stateOf(cur) !== "queued") selectSite(cur); else renderInspect() }
  }
  $("#emptyStage").hidden = state.sites.length > 0 || buildingOnly().length > 0
  renderCounts(); renderBuildingPane()
}
/** prospects being built that have no site folder yet : shown in the rail as « Building », never absent */
function buildingOnly() {
  const have = new Set((state.sites || []).map((x) => x.id)), out = []
  for (const b of state.batches || []) {
    if (!["queued", "running"].includes(b.status) || b.mode !== "composer") continue
    let ids = []; try { ids = JSON.parse(b.params_json || "{}").ids || [] } catch { /* */ }
    for (const id of ids) if (!have.has(id) && !out.some((x) => x.id === id)) out.push({ id, date: "", hasIndex: false, status: "draft", name: siteNameOf(id), pending: true })
  }
  return out
}
async function loadBatches() { const r = await api("/api/batches"); state.batches = (r && r.batches) || []; $("#v-sites").classList.toggle("nosites", !(state.sites || []).length && !buildingOnly().length); $("#emptyStage").hidden = (state.sites || []).length > 0 || buildingOnly().length > 0; renderRail(); renderInspect(); renderBuildingPane() }
function buildState(id) {
  // its own site landed while the batch goes on : it is built, not « Building » until the last one
  if ([...jobs.live.values()].some((j) => j.mode === "composer" && (j.done || []).includes(id))) return null
  for (const b of state.batches) {
    if (!["queued", "running"].includes(b.status) || b.mode !== "composer") continue
    let ids = []; try { ids = JSON.parse(b.params_json || "{}").ids || [] } catch { /* */ }
    if (ids.includes(id)) return b.status === "running" ? "building" : "queued"
  }
  return null
}
/** the job (« composer » or « edit ») queued or running for a site, or "" */
function siteJob(id) {
  for (const b of state.batches || []) {
    if (!["queued", "running"].includes(b.status) || !["composer", "edit", "template-fill"].includes(b.mode)) continue
    let p = {}; try { p = JSON.parse(b.params_json || "{}") } catch { /* */ }
    if ((p.ids || []).includes(id) || p.id === id) return b.mode === "edit" ? "edit" : "composer"
  }
  for (const j of jobs.rows.values()) if (["queued", "running"].includes(j.status) && (j.mode === "edit" || j.mode === "composer") && (((j.params || {}).ids || []).includes(id) || (j.params || {}).id === id)) return j.mode
  return ""
}
function stateOf(s) {
  const b = buildState(s.id); if (b) return b
  if (s.hasIndex === false) return "building"
  // the lead's step in Outreach wins : a lost lead's site says Lost, a won one Won
  if (s.crmStage === "lost") return "lost"
  if (s.crmStage === "signature") return "won"
  return { approved: "approved", rejected: "rejected", sent: "contacted", drafted: "contacted", superseded: "old" }[s.status] || "new"
}
const STATE_LABEL = { new: "Waiting for you", approved: "In outreach", rejected: "Skipped", contacted: "In outreach", queued: "Building", building: "Building", old: "Old", lost: "Lost", won: "Won" }
const STATE_CLS = { new: "needs", approved: "approved", rejected: "skipped", contacted: "approved", queued: "building", building: "building", old: "", lost: "skipped", won: "won" }
// the filmstrip's groups : what waits for you first, then what moved on
const RAIL_GROUP = { new: 0, building: 0, queued: 0, approved: 1, contacted: 1, won: 2, rejected: 3, lost: 3, old: 3 }
const RAIL_HEAD = ["Waiting for you", "In outreach", "Clients", "Skipped and lost"]
function siteName(s) { return s.name || (state.leads[s.id] && state.leads[s.id].name) || s.id.replace(/-/g, " ") }
function siteSub(s) { const l = state.leads[s.id] || {}; return [trade(l.industry), place(s.city || l.city, l.region, l.zip)].filter(Boolean).join(" · ") }
// the day a site was built (its folder is dated YYYY-MM-DD), read as a local day
function siteDateMs(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s.genDate || s.date || "")); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : 0 }
const daysAgo = (ms) => { if (!ms) return ""; const d = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86400000); return d <= 0 ? "Today" : d === 1 ? "Yesterday" : d < 7 ? `${d} days ago` : fmtDate(ms) }
function railSites() { return [...buildingOnly(), ...(state.sites || [])] }
/** the filmstrip : a capture of each new site, grouped ; redrawn only when its sites change (a capture is never
 *  reloaded for a new dot or a new selection) */
function renderRail() {
  const rail = $("#rail")
  const all = railSites()
  if (!all.length) { rail.innerHTML = `<div class="empty">No sites yet</div>`; delete rail.dataset.sig; return }
  const groups = RAIL_HEAD.map(() => [])
  for (const s of all) groups[RAIL_GROUP[stateOf(s)] ?? 3].push(s)
  const pending = (s) => stateOf(s) === "building" || stateOf(s) === "queued" || !!s.pending
  // the dates are written in the agency's locale and zone : a render before the agency was known is redone once it is
  const sig = `${L.locale}|${L.timezone || ""}#` + groups.map((g) => g.map((s) => `${s.id}|${s.date}|${s.shot ? 1 : 0}|${pending(s) ? 1 : 0}`).join(",")).join("/")
  const had = document.activeElement && document.activeElement.closest && document.activeElement.closest("#rail .card")
  const keep = had ? [had.dataset.id, had.dataset.date] : null
  if (rail.dataset.sig !== sig) {
    rail.dataset.sig = sig
    rail.innerHTML = groups.map((g, i) => g.length ? `<div class="rgroup ${i ? "done" : ""}"><h2>${RAIL_HEAD[i]} <span>${g.length}</span></h2><div class="row">${g.map((s) => `<a class="card" data-id="${esc(s.id)}" data-date="${esc(s.date)}" role="button" tabindex="0" aria-pressed="false">
      <div class="thumb">${pending(s) ? `${oldThumb(s.id)}<span class="veil"></span><span class="scan"></span>` : siteThumb(s.id, s.date)}</div>
      <div class="row1"><span class="name">${esc(siteName(s))}</span><span class="sdot" aria-hidden="true"></span><span class="sr"></span></div>
      <div class="sub"><span class="t">${esc(siteSub(s))}</span><span class="when">${s.pending ? "" : esc(daysAgo(siteDateMs(s)))}</span></div></a>`).join("")}</div></div>` : "").join("")
    $$("#rail .card").forEach((c) => c.onclick = () => { const s = railSites().find((x) => x.id === c.dataset.id && x.date === c.dataset.date); if (s) selectSite(s) })
    observeLive(rail)
  }
  // the state of each card, in place : a dot AND a word (for a screen reader), the selection
  for (const c of $$("#rail .card")) {
    const s = all.find((x) => x.id === c.dataset.id && x.date === c.dataset.date); if (!s) continue
    const st = stateOf(s), on = !!(state.sel && state.sel.id === s.id && state.sel.date === s.date)
    c.classList.toggle("on", on); c.setAttribute("aria-pressed", on ? "true" : "false"); c.title = `${siteName(s)} · ${STATE_LABEL[st]}`
    c.querySelector(".sdot").className = `sdot ${STATE_CLS[st]}`; c.querySelector(".sr").textContent = STATE_LABEL[st]
    if (pending(s)) { const g = buildProgress(s.id), th = c.querySelector(".thumb"); th.style.setProperty("--p", g.queued ? "0%" : `${g.pct != null ? g.pct : 30}%`); th.classList.toggle("queued", g.queued); c.querySelector(".when").textContent = g.queued ? "Waiting its turn" : g.pct != null ? `Building · ${Math.round(g.pct)}%` : "Building" }
  }
  // the keyboard stays on the card it was on
  if (keep) { const c = $$("#rail .card").find((x) => x.dataset.id === keep[0] && x.dataset.date === keep[1]); if (c && document.activeElement !== c) c.focus() }
  // the selected card is brought into view on the sideways strip (never clipped off the edge)
  const on = $("#rail .card.on"); if (on) { const r = rail.getBoundingClientRect(), c = on.getBoundingClientRect(); if (r.width && (c.left < r.left || c.right > r.right)) rail.scrollLeft += c.left - r.left - (r.width - c.width) / 2 }
}
function selectSite(s) {
  state.sel = s
  const built = stateOf(s) !== "building" && stateOf(s) !== "queued"
  const src = built ? `/preview/${enc(s.id)}/${enc(s.date)}/index.html` : "about:blank"
  if (!$("#preview").src.endsWith(src)) $("#preview").src = src
  state.beforeFor = null
  setView(state.viewMode)
  renderRail(); renderInspect(); loadComment(); renderBuildingPane(); loadSitePrefs(s)
}
/** a site still building : their old site, the line sweeping down it, where it is */
function renderBuildingPane() {
  const s = state.sel, pane = $("#buildingPane"); if (!s) { pane.hidden = true; return }
  const st = stateOf(s)
  if (st !== "building" && st !== "queued") { pane.hidden = true; $("#frame").hidden = false; return }
  const g = buildProgress(s.id)
  pane.hidden = false; $("#frame").hidden = true
  const say = g.queued ? `${siteName(s)} · waiting its turn` : `Building ${siteName(s)}${g.pct != null ? ` · ${Math.round(g.pct)}%` : ""}`
  if (pane.dataset.id !== s.id) { pane.dataset.id = s.id; pane.innerHTML = `<div class="thumb">${oldThumb(s.id)}<span class="veil"></span><span class="scan"></span></div><span class="over" role="status"></span>` }
  const th = pane.querySelector(".thumb"); th.style.setProperty("--p", g.queued ? "0%" : `${g.pct != null ? g.pct : 30}%`); th.classList.toggle("queued", g.queued)
  pane.querySelector(".over").textContent = say
}
/** « Why it's on your list » : the problems in plain sentences, the words before the colon in bold */
const whyLine = (t) => { const i = t.indexOf(":"); return i > 0 && i < 60 ? `<b>${esc(t.slice(0, i))}</b>${esc(t.slice(i))}` : esc(t) }
function builtWhen(s) { const d = daysAgo(siteDateMs(s)); return !d ? "" : /^(Today|Yesterday)$/.test(d) ? `Built ${d.toLowerCase()}` : /ago$/.test(d) ? `Built ${d}` : `Built on ${d}` }
function renderInspect() {
  const s = state.sel
  if (!$("#iTitle")) return
  if (!s) { $("#iTitle").textContent = ""; $("#iState").textContent = ""; $("#iWhen").textContent = ""; $("#iMeta").textContent = ""; $("#iWhy").innerHTML = ""; $("#iWhyWrap").hidden = true; $("#iOld").hidden = true; $("#iDemo").hidden = true; $("#iOutreach").hidden = true; $("#iNoReach").hidden = true; $("#iPrefs").hidden = true; for (const id of ["#approve", "#rebuild", "#reject", "#apply"]) $(id).disabled = true; return }
  // a demo build is a stand-in, said in one quiet line under the title, with a real build one click away
  $("#iDemo").hidden = !s.simulated
  const st = stateOf(s), l = state.leads[s.id] || {}, p = state.prospectsData && state.prospectsData.items.find((x) => x.id === s.id)
  $("#iTitle").textContent = siteName(s)
  $("#iState").className = `chip status ${STATE_CLS[st]}`; $("#iState").textContent = STATE_LABEL[st]
  $("#iWhen").textContent = s.pending ? "" : builtWhen(s)
  $("#iMeta").textContent = siteSub(s)
  const why = p ? (p.why && p.why.length ? p.why : p.reasons) : []
  $("#iWhyWrap").hidden = !why.length
  $("#iWhy").innerHTML = why.slice(0, 3).map((r) => `<li>${whyLine(r)}</li>`).join("")
  const old = (p && p.oldUrl) || l.oldUrl; $("#iOld").hidden = !old; if (old) { $("#iOld").href = (p && p.oldHref) || l.oldHref || old; $("#iOld").innerHTML = `${IC.globe}<span>Their site today · ${esc(old.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</span>` }
  const building = st === "building" || st === "queued", stopped = paused(), job = siteJob(s.id)
  // a site that already left Sites (in outreach, won, lost) says so and links there : no grey button that does nothing
  const gone = ["approved", "contacted", "lost", "won"].includes(st)
  $("#approve").hidden = gone
  $("#approve").disabled = building || !!job
  $("#approve").title = building ? "Still building: you can send it once it is built" : ""
  $("#iOutreach").hidden = !gone; $("#iOutreach").textContent = st === "won" ? "Open the client in Outreach" : "Open in Outreach"
  // no way to reach them : said before you send the site anywhere
  const pr = p || {}; const noReach = !!p && !pr.phone && !pr.email
  $("#iNoReach").hidden = !noReach; $("#iNoReach").textContent = noReach ? "No phone and no email on their site: find a contact before you send it to outreach." : ""
  // one job per site at a time : while a build or your feedback runs, Rebuild and Apply wait (never paid twice)
  const busyWhy = job ? (job === "edit" ? "Your feedback is being applied: wait for it to finish" : "Being built: wait for it to finish") : ""
  $("#rebuild").hidden = st === "won" || st === "lost"
  $("#rebuild").disabled = building || stopped || !!job; $("#rebuild").title = stopped ? PAUSED : busyWhy || "Rebuild"
  $("#reject").hidden = gone || st === "rejected"
  $("#reject").disabled = building
  $("#apply").disabled = building || stopped || !!job; $("#apply").title = stopped ? PAUSED : busyWhy
  $("#v-sites").classList.toggle("review", st === "new")
  $("#openTab").classList.toggle("disabled", building); $("#openTab").setAttribute("aria-disabled", building ? "true" : "false")
  renderSitePrefs(); renderThread()
}
/* ── « Built with 3 of your preferences » and the feedback thread ── */
const siteKey = (s) => `${s.id}|${s.date}`
async function loadSitePrefs(s, fresh = false) {
  if (!s || s.pending || stateOf(s) === "building" || stateOf(s) === "queued") { $("#iPrefs").hidden = true; return }
  const k = siteKey(s)
  state.prefs = state.prefs || {}
  if (!fresh && state.prefs[k]) { renderSitePrefs(); return }
  const r = await api(`/api/learning/site?id=${enc(s.id)}&date=${enc(s.date)}`)
  if (r && r.sentence) state.prefs[k] = r
  if (state.sel && siteKey(state.sel) === k) { renderSitePrefs(); const c = $("#compare:not([hidden]) .half.r .lbl .faint"); if (c && r && r.sentence) c.textContent = r.sentence }
}
function renderSitePrefs() {
  const s = state.sel, box = $("#iPrefs"); if (!s || !box) return
  const r = state.prefs && state.prefs[siteKey(s)]
  if (!r) { box.hidden = true; return }
  const list = [...(r.applied || []).map((x) => `<li>${IC.check}<span>${esc(x.text)}${x.exists === false ? ` <span class="faint">(deleted since)</span>` : x.on === false ? ` <span class="faint">(switched off since)</span>` : ""}</span></li>`), ...(r.skipped || []).map((x) => `<li class="skip">${IC.x}<span>${esc(x.text)}${x.why ? `<br><span class="faint">${esc(x.why)}</span>` : ""}</span></li>`)]
  const html = `<summary>${IC.checks}<span>${esc(r.sentence)}</span>${IC.chev}</summary>${list.length ? `<ul>${list.join("")}</ul>` : ""}<div class="foot"><button type="button" class="link linkbtn" data-learned>Everything the agency learned</button></div>`
  if (box.dataset.sig !== html) { const open = box.open; box.innerHTML = html; box.dataset.sig = html; box.open = open; box.querySelector("[data-learned]").onclick = () => openLearned() }
  box.hidden = false
}
/** what you said on this site and what the agency took from it : « Got it… I'll remember: … » with its Undo */
function renderThread() {
  const s = state.sel, box = $("#iThread"); if (!box) return
  const t = s && state.thread && state.thread[siteKey(s)]
  if (!t) { box.innerHTML = ""; return }
  const r = t.remember
  const took = r && r.forgotten ? `<div class="remember quiet"><span class="dot"></span><p><strong>Forgotten.</strong> It won't be used in the next builds.</p></div>`
    : r && r.pending ? `<div class="remember quiet"><span class="dot live"></span><p><strong>${esc(t.head)}</strong> Reading what to remember from it…</p></div>`
    : r && r.text ? `<div class="remember" role="status"><span class="dot needs"></span><p><strong>${esc(t.head)}</strong> ${esc(r.text)}</p>${r.undo ? `<button type="button" class="btn sm quiet" data-undo="${esc(r.undo)}">Undo</button>` : ""}</div>`
    : `<div class="remember quiet" role="status"><span class="dot ok"></span><p><strong>${esc(t.head)}</strong> A one-off fix: nothing to remember for the next builds.</p></div>`
  box.innerHTML = `${t.said ? `<div class="said"><b>You, ${esc(when(t.at))}</b>${esc(t.said)}</div>` : ""}${took}`
  const u = box.querySelector("[data-undo]"); if (u) u.onclick = () => busy(u, async () => { const x = await forget(u.dataset.undo); if (x) { t.remember = { forgotten: true }; renderThread() } })
}
/** an Undo of what the agency just learned (works once) */
async function forget(undo) {
  const r = await api("/api/learning/undo", { undo })
  if (r && r.ok) { toast(r.text || "Forgotten."); loadLearning(); if (state.sel) loadSitePrefs(state.sel, true); return true }
  toast((r && r.error) || "Already forgotten", true); return false
}
/** the preferences an answer says are new : they carry the lime dot in « What the agency learned » */
function markFresh(m) { if (!m || !Array.isArray(m.preferences)) return; state.freshPrefs = state.freshPrefs || new Set(); for (const p of m.preferences) if (p && p.id && p.isNew !== false) state.freshPrefs.add(p.id) }
/** « I'll remember: … » after a decision, with its Undo (nothing more when it was a one-off) */
function sayRemember(prefix, r, undoStatus) {
  const m = r && r.remember
  markFresh(m)
  if (m && m.text) toast(`${prefix}. ${m.text}`, false, { remember: true, undo: m.undo ? () => forget(m.undo) : undoStatus })
  else toast(prefix, false, undoStatus ? { undo: undoStatus } : {})
}
async function setStatus(status, btn) {
  const s = state.sel; if (!s || btn.disabled) return
  if (status === "rejected" && ["approved", "contacted"].includes(stateOf(s)) && !(await askSheet("Remove this site from outreach?", `${siteName(s)} leaves your call list and its emails stop.`, { ok: "Remove", danger: true }))) return
  return busy(btn, async () => {
    const was = stateOf(s), prev = s.status
    const r = await api("/api/status", { id: s.id, date: s.date, status })
    if (!r.ok) { toast(r.error || "Not saved", true); return }
    s.status = status; renderRail(); renderInspect()
    // the badge counts calls to make : a lead the emails will write to (Send emails automatically, an address) goes to
    // « Emails », not to the call list ; one with no phone is no call either
    const pr = state.prospectsData && state.prospectsData.items.find((x) => x.id === s.id)
    const call = !pr || (!!pr.phone && !(state.agent && state.agent.mode === "sequencer" && pr.email))
    if (call) { if (status === "approved") state.outreachCount = (state.outreachCount || 0) + 1; else if (["approved", "contacted"].includes(was) && state.outreachCount) state.outreachCount-- }
    renderCounts()
    // a skip you regret is one click away
    const back = status === "rejected" && was === "new" ? async () => { const x = await api("/api/status", { id: s.id, date: s.date, status: prev || "draft" }); if (x.ok) { s.status = prev || "draft"; renderRail(); renderInspect(); loadProspects() } } : null
    sayRemember(status === "approved" ? "Sent to outreach" : was === "approved" ? "Removed from outreach" : "Skipped", r, back)
    if (status === "rejected") loadProspects()
    if (r.remember && r.remember.text) loadLearning()
  })
}
$("#approve").onclick = (e) => setStatus("approved", e.currentTarget)
$("#reject").onclick = (e) => setStatus("rejected", e.currentTarget)
// a rebuild costs a build and replaces the version you see : asked first, with what should be different (that is
// feedback too : the agency learns from it)
$("#rebuild").onclick = async (e) => {
  const btn = e.currentTarget, s = state.sel; if (!s || btn.disabled) return
  const st = stateOf(s), out = ["approved", "contacted"].includes(st)
  const demo = !!(state.settings && state.settings.sandbox), per = (state.cage && state.cage.builds && state.cage.builds.perBuildUsd) || 3
  const why = await askSheet(`Rebuild ${siteName(s)}?`, `${out ? "It is already in outreach: the site in their emails changes too. " : ""}A new version replaces this one. ${demo ? "The demo calls no AI." : `A build uses about ${usd(per)} of your plan: an estimate, not a charge.`}`, { input: "What should be different? (optional)", placeholder: "Calmer colors, their own photos first…", ok: "Rebuild" })
  if (why === null) return
  busy(btn, async () => {
    const r = await api("/api/batch", { mode: "composer", ids: [s.id], limit: 1, force: true, note: "rebuild from the cockpit", ...(why ? { feedback: why } : {}) })
    if (r.ok) { sayRemember(r.tomorrow && !r.today ? `${siteName(s)} is rebuilt tomorrow (today's cap is reached)` : `Rebuilding ${siteName(s)}`, r); loadJobs(); loadBatches(); loadCage() } else toast(r.error || "Could not start", true)
  })
}
async function loadComment() {
  const s = state.sel; if (!s) return
  const d = await api(`/api/control?id=${enc(s.id)}&date=${enc(s.date)}`)
  if (state.sel !== s) return
  $("#comment").value = (d && d.control && d.control.comment) || ""
  $("#iMsg").textContent = ""
}
$("#apply").onclick = (e) => busy(e.currentTarget, async () => {
  const s = state.sel; if (!s) return
  const said = $("#comment").value.trim()
  if (!said) { $("#iMsg").className = "msg bad"; $("#iMsg").textContent = "Write what should change first"; $("#comment").focus(); return }
  $("#iMsg").textContent = ""
  await api(`/api/control?id=${enc(s.id)}&date=${enc(s.date)}`, { comment: $("#comment").value })
  const r = await api("/api/refill", { id: s.id, date: s.date })
  if (r.ok) {
    $("#comment").value = ""
    // the exchange : what you said, then what the agency does with it (changed here ; remembered for the next builds)
    state.thread = state.thread || {}
    state.thread[siteKey(s)] = { said, at: Date.now(), head: r.head || "Got it, changing it on this site.", remember: r.remember || null }
    markFresh(r.remember)
    renderThread(); loadJobs(); loadBatches()
    if (r.remember && r.remember.text) loadLearning()
  } else toast(r.error || "Could not apply", true)
})
$("#comment").addEventListener("paste", async (e) => {
  const s = state.sel; if (!s) return
  const f = [...(e.clipboardData && e.clipboardData.files || [])].find((x) => x.type.startsWith("image/")); if (!f) return
  e.preventDefault()
  const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f) })
  const r = await api("/api/upload", { id: s.id, date: s.date, name: f.name || "paste.png", dataUrl: data })
  if (r.file) { const ta = $("#comment"); ta.value += `\n![screenshot](${r.file})`; ta.dispatchEvent(new Event("input")) }
})
/** their old site, as an <img> : on Mobile the phone capture when there is one, else the desktop page (what a phone
 *  shows of a site with no mobile version : the same page, shrunk), said in `note` */
function beforeImg(id, note) {
  const img = new Image(); img.alt = "Their current site"
  const p = state.prospectsData && state.prospectsData.items.find((x) => x.id === id)
  const phone = state.vp !== "full" && !!(p && p.hasBeforeMobile)
  img.src = phone ? `/avant/${enc(id)}?m=1` : `/avant/${enc(id)}`
  if (state.vp !== "full" && !phone && note) note.textContent = "No phone version: shrunk to fit"
  img.onerror = () => img.replaceWith(Object.assign(document.createElement("div"), { className: "empty", textContent: "No capture of the old site" }))
  return img
}
function setView(mode) {
  if (!state.sel) return
  // a phone has no room for two halves : Before and After, one at a time
  if (mode === "compare" && NARROW_PHONE.matches) mode = "after"
  state.viewMode = mode
  if (mode === "before" && state.beforeFor !== `${state.sel.id}:${state.vp}`) {
    state.beforeFor = `${state.sel.id}:${state.vp}`
    const box = $("#before"); box.innerHTML = ""
    const note = Object.assign(document.createElement("p"), { className: "bnote msg" })
    box.append(beforeImg(state.sel.id, note), note)
  }
  $("#before").hidden = mode !== "before"
  $("#compare").hidden = mode !== "compare"
  $("#viewport").style.visibility = mode === "after" ? "visible" : "hidden"
  $$("#viewmode a").forEach((a) => { a.classList.toggle("on", a.dataset.v === mode); a.setAttribute("aria-pressed", a.dataset.v === mode ? "true" : "false") })
  $("#openTab").href = mode === "before" ? `/avant/${enc(state.sel.id)}` : `/preview/${enc(state.sel.id)}/${enc(state.sel.date)}/index.html`
  if (mode === "compare") buildCompare()
}
// Compare: the old site and the new one side by side, at the same width, top-aligned, scrolling together (one scroll
// moves both, in proportion : the two pages end together). The new site is laid out at the width a visitor sees (1440 on
// a desktop, 390 on a phone) and scaled to its half ; the old capture fills its half at the same width.
function buildCompare() {
  const cmp = $("#compare"), s = state.sel
  cmp.classList.toggle("narrow", state.vp !== "full")
  // two aligned frames, the captions under them : their site today (and where it lives), the new one (and what it was
  // built with)
  const p = state.prospectsData && state.prospectsData.items.find((x) => x.id === s.id), l = state.leads[s.id] || {}
  const old = (p && p.oldUrl) || l.oldUrl || "", oldHref = (p && p.oldHref) || l.oldHref || old
  const prefs = state.prefs && state.prefs[siteKey(s)]
  cmp.innerHTML = `<figure class="half l"><div class="sc" id="cmpL"></div><figcaption class="lbl"><span>Their site today</span>${old ? `<a class="faint" href="${esc(oldHref)}" target="_blank" rel="noopener">${esc(old.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>` : ""}<span class="muted" id="cmpNote"></span></figcaption></figure><figure class="half r"><div class="sc"><iframe title="The new site" src="/preview/${enc(s.id)}/${enc(s.date)}/index.html"></iframe></div><figcaption class="lbl"><span>The new site</span><span class="faint">${prefs ? esc(prefs.sentence) : ""}</span></figcaption></figure>`
  const left = $("#cmpL")
  left.append(beforeImg(s.id, $("#cmpNote")), Object.assign(document.createElement("div"), { className: "endnote", textContent: "End of their page" }))
  fitCompare()
  const f = cmp.querySelector("iframe")
  let lock = false
  const ratio = (top, h, view) => (h - view > 0 ? top / (h - view) : 0)
  const sync = (from) => {
    if (lock) return; lock = true
    try {
      const w = f.contentWindow, de = w && w.document && w.document.documentElement
      if (!de) return
      if (from === "l") w.scrollTo(0, ratio(left.scrollTop, left.scrollHeight, left.clientHeight) * Math.max(0, de.scrollHeight - w.innerHeight))
      else left.scrollTop = ratio(w.scrollY, de.scrollHeight, w.innerHeight) * Math.max(0, left.scrollHeight - left.clientHeight)
    } catch { /* another origin : no sync */ } finally { requestAnimationFrame(() => { lock = false }) }
  }
  left.addEventListener("scroll", () => sync("l"), { passive: true })
  f.addEventListener("load", () => { try { f.contentWindow.addEventListener("scroll", () => sync("r"), { passive: true }) } catch { /* */ } })
}
function fitCompare() {
  const sc = $("#compare:not([hidden]) .half.r .sc"); if (!sc) return
  const f = sc.querySelector("iframe"), W = state.vp === "full" ? 1440 : 390, k = Math.min(1, sc.clientWidth / W)
  f.style.width = `${W}px`; f.style.height = `${Math.ceil(sc.clientHeight / k)}px`; f.style.transform = k < 1 ? `scale(${k})` : ""
}
if (window.ResizeObserver) new ResizeObserver(() => fitCompare()).observe($("#view"))
function fitPreview() {
  const vp = $("#viewport"), f = $("#preview"); if (!vp || !f) return
  if (state.vp !== "full") { f.style.width = ""; f.style.height = ""; f.style.transform = ""; return }
  if (!vp.clientWidth || !vp.clientHeight) return // hidden (another view) : measured when it shows
  const W = 1440, k = Math.min(1, vp.clientWidth / W)
  f.style.width = `${W}px`; f.style.height = `${Math.ceil(vp.clientHeight / k)}px`; f.style.transform = k < 1 ? `scale(${k})` : ""
}
if (window.ResizeObserver) new ResizeObserver(() => fitPreview()).observe($("#viewport"))
function setVp(w) { state.vp = w; $("#frame").classList.toggle("narrow", w !== "full"); $$("#vpsel a").forEach((x) => { x.classList.toggle("on", x.dataset.w === w); x.setAttribute("aria-pressed", x.dataset.w === w ? "true" : "false") }); fitPreview(); if (state.sel && state.viewMode !== "after") setView(state.viewMode) }
$$("#viewmode a").forEach((a) => a.onclick = () => setView(a.dataset.v))
$$("#vpsel a").forEach((a) => a.onclick = () => setVp(a.dataset.w))
// a phone shows the site as a phone does ; a desktop as a desktop does
const NARROW_PHONE = window.matchMedia ? matchMedia("(max-width: 760px)") : { matches: false }
setVp(NARROW_PHONE.matches ? "390" : "full")

/* ───────── outreach ───────── */
async function loadOutreach() {
  const [crm, stages, agent] = await Promise.all([api("/api/crm"), api("/api/crm/stages"), api("/api/agent")])
  state.crm = crm && crm.hot ? crm : { hot: {}, closing: {}, lost: [] }
  state.stages = stages && stages.hot ? stages : null
  state.agent = agent
  // calls to make, the server's rule (/api/prospects › toCall) : a call step, a phone, not a lead the emails still write to
  state.outreachCount = allLeads().filter((l) => l.pipeline === "hot" && !["nurturing", "emails", "lost"].includes(l.stage) && l.phone).length; renderCounts()
  renderAgent(); renderBoard()
  if (state.lead) { const l = findLead(state.lead.id); if (l) { state.lead = l; renderLead() } }
}
function renderAgent() {
  const a = state.agent || { mode: "sequencer" }
  // « test mode » is said whenever nothing is sent, including before the status has loaded (never « Send emails
  // automatically » alone while every email is only written)
  const test = !state.cage || state.cage.send.mode === "dry-run"
  const label = { sequencer: `Send emails automatically${test ? " (test mode: written, never sent)" : ""}`, webhook: "Send to my own tool", manual: "Add to my call list" }[a.mode] || a.mode
  $("#agentLine").innerHTML = `When you approve a site: <b>${label}</b>. <button type="button" class="link linkbtn" id="agentChange">Change</button>`
  $("#agentChange").onclick = openApproveMode
}
function allLeads() { const c = state.crm || {}; return [...Object.values(c.hot || {}), ...Object.values(c.closing || {})].flat() }
function findLead(id) { return allLeads().find((l) => l.id === id) || ((state.crm && state.crm.lost) || []).find((l) => l.id === id) }
// a phone gets the stage-grouped list, a wider screen the board : only one of them is in the page
const NARROW = window.matchMedia ? matchMedia("(max-width: 760px)") : { matches: false }
if (NARROW.addEventListener) NARROW.addEventListener("change", () => { if (state.crm) renderBoard() })
/** who to call, grouped by step : a stage picker (All, each step with people in it, Lost), then the queue */
function renderBoard() {
  const s = state.stages, c = state.crm
  const board = $("#board"), ms = $("#mstages"), ml = $("#mlist")
  const narrow = NARROW.matches
  board.hidden = narrow; ml.hidden = !narrow
  const n = state.outreachCount || 0
  $("#oHead").textContent = n ? `${n} call${n === 1 ? "" : "s"} to make` : allLeads().length ? "No calls to make right now" : "Outreach"
  const emptyHero = `<div class="hero"><b>Nothing to call yet</b><span>Approved sites land here, ready to call. <a href="#sites">Review your sites</a></span></div>`
  const lostList = c ? c.lost || [] : []
  if (!s || !c || (!allLeads().length && !lostList.length)) { board.innerHTML = narrow ? "" : emptyHero; ml.innerHTML = narrow ? emptyHero : ""; ms.hidden = true; ms.innerHTML = ""; $("#boardFilter").innerHTML = ""; renderNext(); return }
  const lost = state.boardFilter === "lost"
  const cols = lost ? [{ pipe: "lost", st: { key: "lost", label: "Lost" } }] : [...s.hot.map((st) => ({ pipe: "hot", st })), ...s.closing.map((st) => ({ pipe: "closing", st }))]
  const items = (x) => x.pipe === "lost" ? lostList : (c[x.pipe] && c[x.pipe][x.st.key]) || []
  const id = (x) => `${x.pipe}:${x.st.key}`
  const full = cols.filter((x) => items(x).length)
  if (lost) state.mstage = ""
  if (state.mstage && !full.some((x) => id(x) === state.mstage)) state.mstage = ""
  // the picker : one segment per step with people in it ; Won is its own segment (your clients), Lost a filter
  ms.hidden = full.length < 2 && !lostList.length
  ms.innerHTML = lost ? `<button type="button" data-ms="" aria-pressed="false">Everyone</button><button type="button" id="showLost" class="on" aria-pressed="true">Lost <i>${lostList.length}</i></button>`
    : [`<button type="button" data-ms="" class="${state.mstage ? "" : "on"}" aria-pressed="${state.mstage ? "false" : "true"}">All <i>${full.reduce((k, x) => k + items(x).length, 0)}</i></button>`, ...full.map((x) => `<button type="button" data-ms="${esc(id(x))}" ${x.st.key === "signature" ? `id="showWon"` : ""} class="${state.mstage === id(x) ? "on" : ""}" aria-pressed="${state.mstage === id(x) ? "true" : "false"}">${esc(x.st.label)} <i>${items(x).length}</i></button>`), lostList.length ? `<button type="button" id="showLost" aria-pressed="false">Lost <i>${lostList.length}</i></button>` : ""].join("")
  $$("#mstages [data-ms]").forEach((b) => b.onclick = () => { state.boardFilter = null; state.mstage = b.dataset.ms; renderBoard() })
  const sl = $("#showLost"); if (sl && !lost) sl.onclick = () => { state.boardFilter = "lost"; state.mstage = ""; renderBoard() }
  const shown = full.filter((x) => !state.mstage || id(x) === state.mstage)
  if (narrow) {
    board.innerHTML = ""
    ml.innerHTML = shown.map((x) => `<h3>${esc(x.st.label)}<span>${items(x).length}</span></h3>${items(x).map(kcard).join("")}`).join("")
  } else {
    ml.innerHTML = ""
    board.innerHTML = shown.map((x) => `<section class="col"><h2 class="colhead"><span>${esc(x.st.label)}</span><i>${items(x).length}</i></h2><div class="cards">${items(x).map(kcard).join("")}</div></section>`).join("")
  }
  observeLive(narrow ? ml : board)
  $("#boardFilter").innerHTML = lost || state.mstage ? `<a class="link" href="#outreach" id="allLeads">Show everyone</a> · ` : ""
  const al = $("#allLeads"); if (al) al.onclick = (e) => { e.preventDefault(); state.boardFilter = null; state.mstage = ""; renderBoard() }
  if (state.lead) for (const k of $$(`.kcard[data-id="${CSS.escape(state.lead.id)}"]`)) k.classList.add("on")
  renderNext()
}
/** the next call, at the right of the queue on a wide screen : who, why now, their new site large, one action */
function renderNext() {
  const box = $("#oNext"); if (!box) return
  const c = state.crm || {}, hot = c.hot || {}, closing = c.closing || {}
  const callable = (l) => !!l.phone
  const pick = (hot.call0 || []).find(callable) || ["relance1", "relance2", "relance3"].flatMap((k) => hot[k] || []).find(callable)
    || (closing.demo || []).find(callable) || (hot.emails || []).find((l) => l.mail && (l.mail.clicks || l.mail.status === "replied") && callable(l))
  if (!pick || NARROW.matches) { box.hidden = true; box.innerHTML = ""; delete box.dataset.sig; return }
  const d = leadDate(pick)
  const why = pick.pipeline === "closing" ? (pick.rdvAt ? `Meeting ${dateTime(pick.rdvAt)}` : "Meeting to plan") : pick.mail && pick.mail.status === "replied" ? "They replied: call them" : pick.mail && pick.mail.clicks ? "They opened the new site from your email" : /relance/.test(pick.stage) ? "A follow-up call" : !pick.email ? "No email address: the phone is the way in" : "Ready to call"
  const ins = (pick.insights || []).slice(0, 2)
  const html = `<div class="nexthead"><span class="dot needs" aria-hidden="true"></span><span>Up next · ${esc(why)}</span></div>
    <h2>${esc(pick.name)}</h2><p class="sub">${esc([trade(pick.industry), place(pick.city, pick.region, pick.zip), pick.contact].filter(Boolean).join(" · "))}</p>
    <div class="nextact"><button type="button" class="btn primary lg" data-call="${esc(pick.id)}">${IC.phone}Call ${esc(pick.name)}</button><span class="faint">${esc(fmtPhone(pick.phone))}</span></div>
    <button type="button" class="thumb" data-call="${esc(pick.id)}" aria-label="Open the call with ${esc(pick.name)}" tabindex="-1">${d ? siteThumb(pick.id, d) : oldThumb(pick.id)}</button>
    ${ins.length ? `<ul class="insights">${ins.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`
  if (box.dataset.sig !== html) { box.innerHTML = html; box.dataset.sig = html; observeLive(box); $$("#oNext [data-call]").forEach((b) => b.onclick = () => openLead(b.dataset.call)) }
  box.hidden = false
}
function mailDot(l) {
  // « no email » meant three things ; each is said : no address, you call first, not in the sequence (yet)
  const m = l.mail; if (!m) return `<span class="dot"></span>${!l.email ? "No email address: call first" : (state.agent && state.agent.mode === "sequencer") ? "Emails not started" : "You call first"}`
  // the emails actually written (never the step about to come), and why they stopped once they did
  const written = m.written != null ? m.written : m.sends
  if (m.status === "active") return `<span class="dot ${m.clicks ? "needs" : "ok"}"></span>${written ? `${written} of ${m.total} emails ${m.test === false ? "sent" : "written"}` : "First email queued"}${m.clicks ? " · clicked the new site" : ""}`
  if (m.status === "waiting-content") return `<span class="dot warn"></span>Next email waiting`
  return `<span class="dot${m.status === "replied" ? " needs" : ""}"></span>${esc(m.stopped || "Emails stopped")}`
}
// the new site of a lead (its date is in its preview's address)
const leadDate = (l) => ((/\/preview\/[^/]+\/([^/]+)\//.exec(l.siteUrl || "") || [])[1]) || ""
function kcard(l) {
  const nx = nextStage(l)
  const d = leadDate(l)
  // what to do about them, in words : a meeting, a reply, the emails, or no way in
  const meta = l.stage === "lost" ? `<span><span class="dot"></span>Lost${l.lastNote && l.lastNote.text ? `: ${esc(short(l.lastNote.text, 48))}` : ""}</span>`
    : l.stage === "signature" ? `<span><span class="dot ok"></span>Your client</span>`
    : `${l.rdvAt && l.pipeline === "closing" ? `<span><span class="dot needs"></span>Meeting ${esc(dateTime(l.rdvAt))}</span>` : ""}<span>${mailDot(l)}</span>`
  return `<div class="kcard" data-id="${esc(l.id)}" data-act="call" tabindex="0" role="button" aria-label="${esc(l.name)}">
    <div class="thumb">${d ? siteThumb(l.id, d) : l.id ? oldThumb(l.id) : ""}</div>
    <div class="kb">
      <div class="name">${esc(l.name)}</div>
      <div class="sub">${esc([trade(l.industry), place(l.city, l.region, l.zip)].filter(Boolean).join(" · "))}</div>
      <div class="meta">${meta}${l.phone ? `<span class="tel">${esc(fmtPhone(l.phone))}</span>` : ""}${l.optOut ? `<span class="chip tag" title="They asked for no more emails: a call is still fine">${l.optOut === "unsub" ? "Unsubscribed" : "No more emails"} · call only</span>` : ""}${!l.phone && !l.email ? `<span class="chip tag warn" title="Find a contact before you call, or skip them">No phone, no email</span>` : ""}</div>
    </div>
    <div class="kact">${l.stage === "lost" ? `<button class="btn sm quiet" data-unlose="${esc(l.id)}">Back to the call list</button>` : nx ? `<button class="btn sm quiet" data-next="${esc(l.id)}">${nx === "nurturing" ? "Move to Nurturing" : "Next step"} ${IC.arrow}</button>` : ""}</div>
  </div>`
}
$("#editStages").onclick = openStages
/** after a move, the keyboard is on the card where it landed (never back on the page's top) */
function focusLead(id) { requestAnimationFrame(() => { const k = $$(`.kcard[data-id="${CSS.escape(id)}"]`).find((x) => x.offsetParent !== null); if (k) k.focus({ preventScroll: false }) }) }
document.addEventListener("click", (e) => {
  if (!e.target.closest("#board, #mlist, #lead")) return
  const nb = e.target.closest("[data-next]")
  if (nb) { e.stopPropagation(); const l = findLead(nb.dataset.next); if (!l) return; busy(nb, async () => { const r = await api("/api/crm/stage", { id: l.id, pipeline: l.pipeline, stage: nextStage(l) }); if (r.ok) toast(`${l.name} → ${(state.stages[l.pipeline].find((x) => x.key === nextStage(l)) || {}).label || "next step"}`); else toast(r.error || "Not moved", true); await loadOutreach(); focusLead(l.id) }); return }
  const ub = e.target.closest("[data-unlose]")
  if (ub) { e.stopPropagation(); const l = findLead(ub.dataset.unlose); if (!l) return; busy(ub, async () => { const r = await api("/api/crm/stage", { id: l.id, pipeline: "hot", stage: "call0" }); if (r.ok) toast(`${l.name} is back on your call list`); else toast(r.error || "Not moved", true); await loadOutreach() }); return }
  // the second click of a double-click on « Next step » lands on the moved card : it opens nothing
  const k = e.target.closest(".kcard"); if (k && !(e.detail > 1)) openLead(k.dataset.id)
})

/** the emails the sequence wrote to a lead, readable in the Email tab (subject, body, footer) */
async function loadMails(id, written) {
  if (state.mailsLoading === id) return
  state.mailsLoading = id
  const r = await api(`/api/sequences/emails?id=${enc(id)}`)
  state.mailsLoading = null
  state.mails = { id, written, emails: (r && r.emails) || [] }
  if (state.lead && state.lead.id === id && state.ltab === "email") renderLead()
}
/* ───────── call panel ───────── */
// the call panel is a dialog : focus moves in when it opens, stays in, and goes back to the card when it closes
let leadOpener = null
function openLead(id) { const l = findLead(id); if (!l) return; const fresh = $("#lead").hidden; if (fresh) leadOpener = opener(); state.lead = l; state.ltab = "script"; state.askOut = null; state.insOpen = false; state.lshow = "after"; renderLead(); for (const k of $$(".kcard.on")) k.classList.remove("on"); for (const k of $$(`.kcard[data-id="${CSS.escape(id)}"]`)) k.classList.add("on"); if (fresh) $("#lead").focus() }
function closeLead() {
  const was = state.lead; state.lead = null; $("#lead").hidden = true; $("#leadScrim").hidden = true; $("#lead").innerHTML = ""; delete $("#lead").dataset.id
  for (const k of $$(".kcard.on")) k.classList.remove("on")
  if (!was) return
  // the board was re-rendered meanwhile : the same lead's card, else what opened it
  const card = $$(`.kcard[data-id="${CSS.escape(was.id)}"]`).find((k) => k.offsetParent !== null)
  refocus(card || leadOpener); leadOpener = null
}
// the dimmed page behind the call panel closes it (as Escape does)
$("#leadScrim").onclick = closeLead
const ORDER = { hot: ["emails", "call0", "relance1", "relance2", "relance3", "nurturing"], closing: ["demo", "propal", "nego", "signature"] }
function stageLabel(l) { if (l.stage === "lost") return "Lost"; const s = state.stages; const st = s && s[l.pipeline] && s[l.pipeline].find((x) => x.key === l.stage); return st ? st.label : l.stage }
function nextStage(l) { const o = ORDER[l.pipeline] || ORDER.hot; const i = o.indexOf(l.stage); return i >= 0 && i < o.length - 1 ? o[i + 1] : null }
/** « plumbers », « pool builders », « general contractors » ; a trade that is not a person reads « pest control businesses » */
function tradePlural(t) { t = String(t || "").trim(); if (!t) return "local businesses"; return /(er|or|ist|ian|smith|maker|ect|ant)$/i.test(t) ? `${t}s` : `${t} businesses` }
/** « pool builders, roofers and landscapers » : a list in plain English (never « and … and … and ») */
function listAnd(xs) { return xs.length <= 1 ? (xs[0] || "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` }
/** what was sent to them by email (a follow-up never pretends they saw an email that never went out) */
const emailed = (l) => !!(l.mail && l.mail.sends > 0)
/** The call script : what you SAY (in the prospect's language) and what you DO (an instruction, in the cockpit's
 *  English). A won client gets the next steps, not a sales script. The first call opens with the opening the agency
 *  is testing or leaning on (its callAngle). */
function baseScript(l) {
  const ag = state.agency || {}
  // « Harbor & Pine Web Co. » + « . » never reads « Co.. »
  const agency = String(ag.name || ag.signature || "our studio").replace(/[.\s]+$/, "")
  const me = ag.firstName || ""
  const fr = String(l.lang || ag.language || "en").toLowerCase().startsWith("fr")
  const tr = (trade(l.industry) || "").toLowerCase()
  if (l.stage === "signature") return { say: "", tip: [`${l.name} is a client.`, "Next steps: send the invoice, collect their domain and their logins, agree on the launch date, then put the site live.", "Ask who else they know who needs a site."].join("\n\n") }
  if (l.pipeline === "closing") return { say: "", tip: [`Meeting with ${l.name}`, "Walk through the new site next to the old one. Listen to what they need. Then the offer: launch, price, timeline.", "On price: ask what a new customer is worth to them first, then the number."].join("\n\n") }
  if (l.stage === "nurturing") return { say: "", tip: [`${l.name} is in Nurturing`, "No cold call. Light touches by email for two months; call again when they show interest."].join("\n\n") }
  const follow = /relance/.test(l.stage || "")
  const opener = !follow && l.callAngle && l.callAngle.opener ? String(l.callAngle.opener).trim() : ""
  const tip = fr ? "If yes: book the meeting below. If not now: note it and pick a day to call back." : "If yes: book the meeting below. If not now: note it and pick a day to call back.\nIf they're busy: ask when is a better time, and note it.\nIf they ask the price: show the site first, the price comes at the meeting.\nIf they have a web person: say it's already built, they can show them too."
  if (fr) {
    const de = /^[aeiouyéèêàâîôû]/i.test(agency) ? `d'${agency}` : `de ${agency}`
    const moi = `ici ${me || "[votre prénom]"}, ${de}`
    const open = follow
      ? (emailed(l) ? `Bonjour, ${moi}. Je reviens vers vous : je vous ai envoyé un e-mail avec le nouveau site que j'ai construit pour ${l.name}, et je voulais savoir ce que vous en pensez.` : `Bonjour, ${moi}. J'ai essayé de vous joindre il y a quelques jours : j'ai construit un nouveau site pour ${l.name}, gratuitement, et je voulais vous le montrer.`)
      : `Bonjour, ${moi}. Je parle bien au responsable de ${l.name} ?\n\n${opener || `Je fais des sites pour les ${tr ? "artisans" : "entreprises"} de la région. J'ai regardé le vôtre et je me suis permis d'en construire un nouveau pour ${l.name}, pour que vous le voyiez déjà fait.`}`
    // French typography : a thin no-break space before ? ! : ; (never a « ? » alone on its line)
    return { say: [open, "Je peux vous le montrer en dix minutes cette semaine ?"].join("\n\n").replace(/ ([?!:;])/g, " $1"), tip }
  }
  const who = l.contact || owner()
  const intro = `Hi, this is ${me || "[your name]"} from ${agency}.`
  const open = follow
    ? (emailed(l) ? `${intro} I'm following up on my email: I built a new website for ${l.name} and wanted to hear what you think.` : `${intro} I tried to reach you a few days ago: I built a new website for ${l.name}, for free, and wanted to show it to you.`)
    : `${intro} Am I speaking with ${who}?\n\n${opener || `I build websites for ${tradePlural(tr)}. I looked at yours and took the liberty of building a new one for ${l.name}, so you can see it already done.`}`
  return { say: [open, "Could I show it to you in a 10-minute call this week?"].join("\n\n"), tip }
}
/** what the sequencer wrote in the history, in plain words (its notes carry French text from the engine) */
function historyLabel(n) {
  if (n.outcome !== "mail") return { note: "Note", rdv: "Meeting", lost: "Lost", reach: "Answered", unreach: "No answer" }[n.outcome] || n.outcome
  const t = String(n.text || "")
  if (/^(Email \d|Replied|Clicked|Unsubscribed|The email|Marked|No click|Next email|Emails stopped)/.test(t)) return t
  if (/RÉPONDU|replied/i.test(t)) return "Replied: call them"
  if (/cliqué|clicked/i.test(t)) return "Clicked the link in the email"
  if (/désinscrit|unsub/i.test(t)) return "Unsubscribed: no more emails"
  if (/plainte|complaint/i.test(t)) return "Marked the email as spam"
  if (/bounce/i.test(t)) return "The email bounced"
  const m = /(?:mail simulé \(dry-run\)|mail envoyé)\s*:\s*(.+)$/.exec(t)
  if (m) return `${/simulé/.test(t) ? "Test email written" : "Email sent"} (${m[1].replace(/-/g, " ")})`
  return "Email"
}
/** the emails, in three lines at the side of the call : what went, what came back, what's next or why it stopped */
function mailSummary(l) {
  const m = l.mail
  if (!m) return `<div><span class="dot"></span>${!l.email ? "No email address on their site: the phone is the way in." : l.optOut ? "They asked for no more emails." : (state.agent && state.agent.mode === "sequencer") ? "Not in the emails yet." : "You call first: no email goes out."}</div>`
  const written = m.written != null ? m.written : m.sends, test = m.test != null ? m.test : (!state.cage || state.cage.send.mode === "dry-run")
  return [`<div><span class="dot ok"></span>${written ? `${written} of ${m.total} ${test ? "written (test mode: never sent)" : "sent"}${m.lastSendAt ? `, last ${esc(when(new Date(m.lastSendAt).getTime()))}` : ""}` : `Email 1 of ${m.total} goes at the next sending round`}</div>`,
    m.clicks ? `<div><span class="dot needs"></span>Clicked the new site${m.clicks > 1 ? ` ${m.clicks} times` : ""}${m.lastClickAt ? `, ${esc(when(new Date(m.lastClickAt).getTime()))}` : ""}</div>` : "",
    m.stopped ? `<div><span class="dot"></span>${esc(m.stopped)}</div>` : m.nextLabel && !m.waiting ? `<div><span class="dot"></span>Next: ${esc(m.nextLabel)}</div>` : m.waiting ? `<div><span class="dot warn"></span>${esc(m.waiting.say || "The next email isn't ready yet.")}</div>` : ""].join("")
}
function renderLead() {
  const l = state.lead; if (!l) return
  const box = $("#lead"); box.hidden = false; $("#leadScrim").hidden = false
  // a re-render keeps the keyboard where it was (a tab, a button, the note)
  const act = document.activeElement && box.contains(document.activeElement) ? document.activeElement : null
  const again = act ? (act.id ? `#${act.id}` : act.dataset.t ? `#ltabs [data-t="${act.dataset.t}"]` : act.dataset.o ? `#lead [data-o="${act.dataset.o}"]` : act.dataset.s ? `#lShow [data-s="${act.dataset.s}"]` : null) : null
  // a live refresh never eats what you were typing (the note, the question)
  const typed = box.dataset.id === l.id ? { note: ($("#lNote") || {}).value || "", ask: ($("#askText") || {}).value || "" } : null
  if (box.dataset.id !== l.id) state.noteOpen = false
  box.dataset.id = l.id
  const won = l.stage === "signature", lost = l.stage === "lost"
  const noReach = !l.phone && !l.email
  const tabs = [["script", won ? "Next steps" : "What to say"], ["email", "Email"], ["history", `Notes${l.notes && l.notes.length ? ` · ${l.notes.length}` : ""}`]]
  if (lost && state.ltab === "script") state.ltab = "history"
  let body = ""
  if (state.ltab === "script") {
    const sc = l.callScript ? { say: l.callScript, tip: "" } : baseScript(l)
    body = `${sc.say ? `<div class="script">${esc(sc.say)}</div>` : ""}${sc.tip ? `<div class="script tip">${esc(sc.tip)}</div>` : ""}`
  }
  else if (state.ltab === "email") {
    const m = l.mail
    const written = m ? (m.written != null ? m.written : m.sends) : 0
    const queued = m && m.status === "active" && !written
    const test = m && m.test != null ? m.test : (!state.cage || state.cage.send.mode === "dry-run")
    const mails = state.mails && state.mails.id === l.id ? state.mails.emails : null
    if (m && written && (!mails || state.mails.written !== written)) loadMails(l.id, written)
    const mailList = (mails || []).slice().reverse().map((x, i) => `<details class="mail"${i === 0 ? " open" : ""}><summary>Email ${x.n} · ${esc(x.label)} · ${esc(x.atLabel)}${x.test ? " · test mode" : ""}</summary><div class="kv"><span class="k">To</span><span>${esc(x.to)}</span><span class="k">Subject</span><b>${esc(x.subject)}</b></div>${x.body != null ? `<div class="out">${esc(x.body)}</div>${x.footer ? `<span class="muted sm">${esc(x.footer)}</span>` : ""}` : `<span class="muted">This email's text isn't on this machine.</span>`}</details>`).join("")
    body = m ? `${queued ? `<span class="msg">Queued: email 1 of ${m.total} is written at the next sending round${test ? " (test mode: written, never sent)" : ""}.</span>` : ""}${m.waiting ? `<span class="msg">${esc(m.waiting.say || "The next email isn't ready yet.")}</span>` : ""}${m.stopped ? `<span class="msg">${esc(m.stopped)}.</span>` : ""}<div class="kv"><span class="k">${test ? "Written" : "Sent"}</span><span>${written} of ${m.total}${m.lastSendAt ? ` · last ${when(new Date(m.lastSendAt).getTime())}` : ""}${test ? " · test mode, nothing sent" : ""}</span><span class="k">Clicks</span><span>${m.clicks}${m.lastClickAt ? ` · last ${when(new Date(m.lastClickAt).getTime())}` : ""}</span>${m.nextLabel && !m.waiting && !m.stopped ? `<span class="k">Next</span><span>${esc(m.nextLabel)}${m.hours ? ` <span class="muted">(sending hours ${esc(m.hours)})</span>` : ""}</span>` : ""}</div>${mailList}` : `<span class="msg">${noReach ? "No phone and no email on their site: find a contact first, or skip them." : !l.email ? "No email address on their site: the phone is the way in." : l.optOut ? "They asked for no more emails." : (state.agent && state.agent.mode === "sequencer") ? "Not in the email sequence yet: it starts when you send a site to outreach with “Send emails automatically”." : "You chose to call first: no email goes out. Change it at the top of Outreach (“When you approve a site”)."}</span>`
  } else {
    const notes = (l.notes || []).slice().reverse()
    body = notes.length ? `<div class="hist">${notes.map((n) => `<div class="h"><span class="k">${fmtDate(n.at)}</span><span><b>${esc(historyLabel(n))}</b>${n.slot ? ` · ${esc((slots().find((x) => x[0] === n.slot) || [])[2] || n.slot)}` : ""}${n.text && n.outcome !== "mail" ? ` · ${esc(n.text)}` : ""}</span></div>`).join("")}</div>` : `<span class="msg">No calls yet.</span>`
  }
  const next = nextStage(l)
  const ins = l.insights || [], open = !!state.insOpen
  const shownIns = open ? ins : ins.slice(0, 2)
  // the one emphasised action of the footer : Next step, else Won (ink) ; the lime stays on the call
  const main = !won && !lost && next ? "next" : !won && !lost ? "won" : ""
  const ask = state.askOut
  const d = leadDate(l), show = state.lshow === "before" && l.oldUrl ? "before" : "after"
  const ang = !won && !lost && l.callAngle && l.callAngle.label ? l.callAngle : null
  box.innerHTML = `<div class="lhead"><div class="ltitle"><h2 id="leadTitle">${esc(l.name)}</h2><div class="sub">${esc([trade(l.industry), place(l.city, l.region, l.zip), l.contact, stageLabel(l)].filter(Boolean).join(" · "))}</div></div>
      ${l.phone ? `<a class="btn ${won || lost ? "lg" : "primary xl call"}" href="${esc(telHref(l.phone))}">${IC.phone}${esc(fmtPhone(l.phone))}</a>` : ""}
      <button class="btn icon quiet" id="lClose" aria-label="Close">${IC.x}</button></div>
    <div class="lbody">
      <div class="lmain">
        ${noReach ? `<span class="msg bad" id="lNoReach">No phone and no email on their site: find a contact (their Google listing, a visit) before you call, or skip them.</span>` : ""}
        ${lost ? `<div class="lostnote"><b>Marked lost</b><span>${esc(l.name)} is off your call list${l.lastNote && l.lastNote.text ? `: “${esc(l.lastNote.text)}”` : "."}</span><button type="button" class="btn" data-unlose="${esc(l.id)}">Back to the call list</button></div>` : ""}
        <div class="tabrow"><div class="ltabs" id="ltabs" role="tablist" aria-label="Call notes">${tabs.map(([k, t]) => `<a data-t="${k}" class="${state.ltab === k ? "on" : ""}" role="tab" tabindex="0" aria-selected="${state.ltab === k ? "true" : "false"}" aria-controls="lcontent">${t}</a>`).join("")}</div>${ang ? `<button type="button" class="angle" id="lAngle" title="${esc(ang.why || "")}">${IC.trend}<span>Opening: ${esc(ang.label)}</span></button>` : ""}</div>
        <div id="lcontent" role="tabpanel">${body}</div>
        ${lost ? "" : `<form class="sect" id="askForm"><label class="lbl" for="askText">Ask the agent</label><div class="askrow"><input id="askText" type="text" placeholder="${l.email ? `A follow-up email, what to say if ${esc(l.contact || "they")} pushes back…` : "A call angle, what to say about their site…"}"><button class="btn sm" id="askGo" type="submit">Ask</button></div>
        ${ask ? `<div class="answer"><div class="ahead"><span class="q">${esc(ask.q)}</span><span class="spacer"></span><button type="button" class="btn sm quiet" id="askCopy">${IC.copy}Copy</button><button type="button" class="btn sm quiet" id="askClear">Clear</button></div>${ask.note ? `<span class="msg">${esc(ask.note)}</span>` : ""}<div class="out">${esc(ask.text)}</div><span class="muted">${ask.simulated ? "Demo answer: written from what the demo knows, no AI was called" : "The agent · just now"}</span></div>` : ""}</form>`}
      </div>
      <aside class="lside">
        ${d || l.oldUrl ? `<div class="sitecard"><a class="thumb" href="${esc(show === "before" ? (l.oldHref || l.oldUrl) : l.siteUrl)}" target="_blank" rel="noopener" title="${show === "before" ? "Their site today" : "The new site"}, in a new tab">${show === "before" ? oldThumb(l.id) : d ? siteThumb(l.id, d) : oldThumb(l.id)}</a>
          <div class="showrow">${l.oldUrl && d ? `<span class="seg" id="lShow" role="group" aria-label="Which site"><a data-s="before" class="${show === "before" ? "on" : ""}" role="button" tabindex="0" aria-pressed="${show === "before"}">Before</a><a data-s="after" class="${show === "after" ? "on" : ""}" role="button" tabindex="0" aria-pressed="${show === "after"}">After</a></span>` : ""}<span class="spacer"></span>${d ? `<button type="button" class="btn sm quiet" id="lCopy">${IC.copy}Copy link</button>` : ""}</div></div>` : ""}
        ${ins.length ? `<section class="sect" aria-labelledby="insTitle"><h3 class="lbl" id="insTitle">Worth knowing</h3><ul class="insights">${shownIns.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>${ins.length > 2 ? `<button type="button" class="linkbtn link" id="insMore" aria-expanded="${open ? "true" : "false"}">${open ? "Show less" : `Show ${ins.length - 2} more`}</button>` : ""}</section>` : ""}
        <section class="sect"><h3 class="lbl">Emails</h3><div class="mailsum">${mailSummary(l)}</div></section>
      </aside>
    </div>
    ${lost ? "" : `<div class="lfoot${state.noteOpen ? " noting" : ""}">
      <div class="orow">
        <button type="button" class="btn icon phoneonly" id="lNoteBtn" aria-label="Write a note about this call" aria-expanded="${state.noteOpen ? "true" : "false"}" title="A note">${IC.pencil}</button>
        <div class="notewrap"><textarea id="lNote" rows="1" placeholder="A note about this call" aria-label="A note about this call"></textarea><button type="button" class="btn icon subtle sm" data-o="note" aria-label="Save the note" title="Save the note">${IC.check}</button></div>
        <div class="omore" id="lMoreMenu" role="group" aria-label="Other outcomes">
          <button class="btn quiet danger" data-o="lost">${won ? "Mark lost" : "Lost"}</button>
          ${l.pipeline !== "closing" ? `<button class="btn quiet" data-o="unreach">No answer</button>` : ""}
          ${!won && main !== "won" ? `<button class="btn" data-o="won">${IC.check}Won</button>` : ""}
        </div>
        ${l.pipeline !== "closing" ? `<button class="btn" data-o="meeting" aria-expanded="false" aria-controls="lMeeting">${IC.cal}Meeting</button>` : ""}
        ${main ? `<button class="btn solid" data-o="${main}">${main === "next" ? `Next step ${IC.arrow}` : `${IC.check}Won`}</button>` : ""}
        ${won ? `<a class="btn solid" id="lInvoice" href="/billing.html?client=${enc(l.id)}">${IC.bill}Create invoice</a>` : ""}
        <button type="button" class="btn icon phoneonly" id="lMore" aria-label="More outcomes: lost, no answer, won" aria-expanded="false" aria-controls="lMoreMenu"><svg class="ic" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg></button>
      </div>
      <span class="msg" id="lMsg" role="status"></span>
      <div class="meeting" id="lMeeting" hidden><div class="quick" id="lQuick"></div><div class="pickrow" id="lPick" hidden><input id="lWhen" type="datetime-local" aria-label="Meeting date and time, your agency's time" aria-describedby="lMsg lZone"><span class="muted" id="lZone"></span><button class="btn" id="lWhenGo">Book meeting</button></div></div>
    </div>`}`
  observeLive(box)
  if (typed && $("#lNote")) { $("#lNote").value = typed.note; if ($("#askText")) $("#askText").value = typed.ask }
  // a phone : the note opens inline from its icon ; Lost, No answer and Won wait behind ⋯ (one footer row)
  const nb = $("#lNoteBtn"); if (nb) nb.onclick = () => { state.noteOpen = !state.noteOpen; const f = box.querySelector(".lfoot"); f.classList.toggle("noting", state.noteOpen); nb.setAttribute("aria-expanded", String(state.noteOpen)); if (state.noteOpen) $("#lNote").focus() }
  const mb = $("#lMore"); if (mb) mb.onclick = () => { const f = box.querySelector(".lfoot"), on = !f.classList.contains("more"); f.classList.toggle("more", on); mb.setAttribute("aria-expanded", String(on)); if (on) { const b = $("#lMoreMenu .btn"); if (b) b.focus() } }
  const ln = $("#lNote"); if (ln) { const fit = () => { ln.style.height = ""; if (ln.scrollHeight > 42) ln.style.height = `${Math.min(120, ln.scrollHeight + 2)}px` }; ln.addEventListener("input", fit); fit() }
  if (again && $(again)) $(again).focus()
  $("#lClose").onclick = closeLead
  const im = $("#insMore"); if (im) im.onclick = () => { state.insOpen = !state.insOpen; renderLead(); $("#insMore") && $("#insMore").focus() }
  const af = $("#askForm"); if (af) af.onsubmit = (e) => { e.preventDefault(); const q = $("#askText").value.trim(); if (!q) return; busy($("#askGo"), async () => { const r = await api("/api/crm/ask", { id: l.id, ask: q }); if (r.ok) { state.askOut = { q, text: r.text, note: r.note || "", simulated: !!r.simulated }; $("#askText").value = ""; renderLead(); $("#askText").value = ""; requestAnimationFrame(() => { const o = document.querySelector("#lead .answer"); if (o) o.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }) }) } else toast(r.error || "The agent could not answer", true) }) }
  const ac = $("#askCopy"); if (ac) ac.onclick = async () => { try { await navigator.clipboard.writeText((state.askOut && state.askOut.text) || ""); toast("Copied") } catch { toast("Select the text to copy it", true) } }
  const ax = $("#askClear"); if (ax) ax.onclick = () => { state.askOut = null; renderLead(); $("#askText").focus() }
  const ag = $("#lAngle"); if (ag) ag.onclick = () => openLearned("words")
  const lc = $("#lCopy"); if (lc) lc.onclick = async () => { try { await navigator.clipboard.writeText(new URL(l.siteUrl, location.href).href); toast("Link to the new site copied") } catch { toast("Select the link to copy it", true) } }
  $$("#lShow [data-s]").forEach((a) => a.onclick = () => { state.lshow = a.dataset.s; renderLead() })
  $$("#ltabs a").forEach((a) => a.onclick = () => { state.ltab = a.dataset.t; renderLead() })
  $$("#lead [data-o]").forEach((b) => b.onclick = () => outcome(b.dataset.o))
  const wg = $("#lWhenGo"); if (wg) wg.onclick = async () => { const t = fromLocalInput($("#lWhen").value); if (!t) { $("#lMsg").className = "msg bad"; $("#lMsg").textContent = "Pick a date"; $("#lWhen").setAttribute("aria-invalid", "true"); $("#lWhen").focus(); return } after(await api("/api/crm/outcome", { id: l.id, outcome: "rdv", rdvAt: t, note: $("#lNote").value.trim() }), "Meeting booked") }
}
// two meetings one click away (the next working days, 10:00 then 15:00 on the AGENCY's clock, said with its zone ;
// the weekday named when it isn't tomorrow), and « Pick a day » for any other time (also on the agency's clock)
function quickSlots(now = Date.now()) {
  // the next working day after a wall-clock date, as { y, m, d } (calendar arithmetic in UTC, weekday from it)
  const next = (w) => { const t = new Date(Date.UTC(w.y, w.m - 1, w.d)); do t.setUTCDate(t.getUTCDate() + 1); while (t.getUTCDay() === 0 || t.getUTCDay() === 6); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() } }
  const today = wall(now), d1 = next(today), d2 = next(d1)
  const a = zoned(d1.y, d1.m, d1.d, 10), b = zoned(d2.y, d2.m, d2.d, 15)
  const ahead = (d) => Math.round((Date.UTC(d.y, d.m - 1, d.d) - Date.UTC(today.y, today.m - 1, today.d)) / 86400000)
  const name = (d, t) => (ahead(d) === 1 ? "Tomorrow" : weekday(t, "long"))
  return [[a, d1], [b, d2]].map(([t, d]) => { const z = zoneName(t); return { t, label: `${name(d, t)} ${time(t)}${z ? ` ${z}` : ""}` } })
}
async function outcome(o) {
  const l = state.lead; if (!l) return
  const note = $("#lNote").value.trim()
  let r
  $("#lMsg").className = "msg"
  if (o === "note") { if (!note) { $("#lMsg").className = "msg bad"; $("#lMsg").textContent = "Write a note first"; $("#lNote").focus(); return } r = await api("/api/crm/note", { id: l.id, text: note }) }
  else if (o === "next") { if (note) await api("/api/crm/note", { id: l.id, text: note }); r = await api("/api/crm/stage", { id: l.id, pipeline: l.pipeline, stage: nextStage(l) }) }
  else if (o === "unreach") r = await api("/api/crm/outcome", { id: l.id, outcome: "unreach", note })
  else if (o === "meeting") {
    const m = $("#lMeeting"); m.hidden = !m.hidden; $("#lead [data-o='meeting']").setAttribute("aria-expanded", m.hidden ? "false" : "true"); $("#lead [data-o='meeting']").classList.toggle("on", !m.hidden)
    if (!m.hidden) {
      $("#lQuick").innerHTML = quickSlots().map((q) => `<button type="button" class="btn" data-t="${q.t}" title="${esc(dateTime(q.t))}">${esc(q.label)}</button>`).join("") + `<button type="button" class="btn" id="lPickBtn" aria-expanded="false" aria-controls="lPick">Pick a day</button>`
      $$("#lQuick [data-t]").forEach((b) => b.onclick = () => busy(b, async () => after(await api("/api/crm/outcome", { id: l.id, outcome: "rdv", rdvAt: Number(b.dataset.t), note: $("#lNote").value.trim() }), "Meeting booked")))
      $("#lPickBtn").onclick = () => { const p = $("#lPick"); p.hidden = !p.hidden; $("#lPickBtn").setAttribute("aria-expanded", p.hidden ? "false" : "true"); $("#lPickBtn").classList.toggle("on", !p.hidden); if (!p.hidden) { $("#lWhen").value = toLocalInput(quickSlots()[0].t); $("#lZone").textContent = zoneName(quickSlots()[0].t); $("#lWhen").focus() } }
    }
    return
  }
  // asked in the cockpit's own sheet, never the browser's confirm()
  else if (o === "lost") { if (!(await askSheet(l.stage === "signature" ? `${l.name} is a client` : `Mark ${l.name} as lost?`, l.stage === "signature" ? `${l.name} is a won client. Mark it lost anyway?` : `It leaves your call list. You can bring it back from “Lost” at the top of Outreach.`, { ok: "Mark lost", danger: true }))) return; r = await api("/api/crm/outcome", { id: l.id, outcome: "lost", note }) }
  else if (o === "won") { if (l.pipeline !== "closing" && !(await askSheet(`Mark ${l.name} as won?`, `${l.name} has no meeting yet. Mark it won anyway?`, { ok: "Mark won" }))) return; if (note) await api("/api/crm/note", { id: l.id, text: note }); r = await api("/api/crm/stage", { id: l.id, pipeline: "closing", stage: "signature" }) }
  after(r, { note: "Saved", next: "Moved", lost: "Marked lost", won: "Won", unreach: "No answer: noted. Try another time of day" }[o])
}
async function after(r, okMsg) {
  if (r && r.ok) { if ($("#lNote")) $("#lNote").value = ""; if ($("#lMsg")) $("#lMsg").textContent = ""; toast(okMsg); await loadOutreach() }
  else { if ($("#lMsg")) { $("#lMsg").className = "msg bad"; $("#lMsg").textContent = (r && r.error) || "Not saved" } toast((r && r.error) || "Not saved", true) }
}

/* ───────── what the agency learned ───────── */
// one place for the learning loop : your taste (preferences that go into every build and edit, each with where it
// came from, a switch, your own words, delete), who to pick first and what to say (sentences with their sample sizes,
// never a claim on a handful). Nothing about weights or models : the API says it in plain words already.
async function loadLearning() {
  const r = await api("/api/learning")
  if (r && r.preferences) { state.learning = r; renderProspectHead(); if (learnOpen()) renderLearned() }
  return state.learning
}
const learnOpen = () => !$("#sheet").hidden && $("#sheet").classList.contains("learn")
async function openLearned(focus) {
  if (!state.learning) await loadLearning()
  if (!state.learning) { toast("Couldn't read what the agency learned", true); return }
  openSheet("What the agency learned", `<div id="learned"></div>`)
  $("#sheet").classList.add("learn")
  renderLearned()
  const at = focus === "picks" ? $("#lnPicks") : focus === "words" ? $("#lnWords") : null
  if (at) requestAnimationFrame(() => at.scrollIntoView({ block: "start" }))
  const t = at ? at.querySelector("h3") : $("#learned .learnhead h2"); t.setAttribute("tabindex", "-1"); t.focus({ preventScroll: !!at })
  if (/#learned/.test(location.hash)) history.replaceState(null, "", "#" + state.view)
}
function renderLearned() {
  const L = state.learning, box = $("#learned"); if (!L || !box) return
  const keepScroll = $("#sheetBody").scrollTop
  // the lime dot : what you just taught, in this visit (the answers to your feedback said which preferences are new)
  const fresh = (p) => !!(state.freshPrefs && state.freshPrefs.has(p.id))
  const pref = (p) => `<div class="lrow ${p.on ? "" : "off"}" data-pid="${esc(p.id)}">
      <p class="say2">${fresh(p) && p.on ? `<span class="new"><span class="dot needs" aria-hidden="true"></span>${esc(p.text)}</span>` : esc(p.text)}</p>
      <p class="ev">${[p.by === "you" ? "Added by you" : p.evidence, p.by === "you" ? "" : p.strength, p.used && p.used.say, p.off].filter(Boolean).map(esc).join(" · ")}</p>
      <div class="ctl"><button type="button" class="btn quiet" data-edit aria-label="Change its words">${IC.pencil}</button><button type="button" class="btn quiet" data-del aria-label="Delete it">${IC.trash}</button><button type="button" class="tog" role="switch" aria-checked="${p.on ? "true" : "false"}" aria-label="Use it: ${esc(p.text)}"></button></div>
    </div>`
  const said = (it) => `<div class="lrow"><p class="say2">${esc(it.sentence)}</p>${it.evidence ? `<p class="ev">${esc(it.evidence)}</p>` : ""}</div>`
  const next = (w, what) => w && w.next ? `<div class="lrow"><p class="say2">Next ${what}: ${esc(w.next.label)}</p><p class="ev">${esc(w.next.why)}</p><div class="ctl"><span class="watch">${w.next.leaning ? "Leaning on it" : "Testing"}</span></div></div>` : ""
  const words = L.words || {}, picks = L.picks || {}
  box.innerHTML = `<div class="learnhead"><div><h2>What the agency learned</h2><p>${esc(L.summary)} It shapes the next builds and calls: switch anything off, change its words, or delete it.</p></div><button type="button" class="btn icon quiet" id="lnClose" aria-label="Close">${IC.x}</button></div>
    <div class="learnbody">
      <div class="lcol"><div class="lsec" id="lnTaste"><h3>Your taste</h3><p class="sub">Every new site and every edit is built with these. They get stronger each time you say the same thing.</p>
        ${(L.preferences || []).length ? L.preferences.map(pref).join("") : `<div class="lempty">Nothing yet. Comment on a site, send it to outreach or skip it: what you like goes into the next builds.</div>`}
        <form class="addpref" id="lnAdd"><input id="lnAddText" type="text" maxlength="200" placeholder="Add one in your own words, like “Their phone number big at the top”" aria-label="A preference in your own words"><button class="btn" type="submit">Add</button></form>
        <span class="msg bad" id="lnMsg" role="alert"></span>
      </div></div>
      <div class="lcol">
        <div class="lsec" id="lnPicks"><h3>Who to pick first</h3><p class="sub">From replies, meetings and wins. Small numbers never decide alone.</p>
          ${(picks.items || []).map(said).join("")}${picks.note ? `<div class="lempty">${esc(picks.note)}</div>` : ""}</div>
        <div class="lsec" id="lnWords"><h3>What to say</h3><p class="sub">The openings of first emails and calls that get answers. New ones lean on them and keep testing.</p>
          ${(words.email && words.email.items || []).map(said).join("")}${words.email && words.email.note ? `<div class="lempty">${esc(words.email.note)}</div>` : ""}${next(words.email, "first email")}
          ${(words.call && words.call.items || []).map(said).join("")}${words.call && words.call.note ? `<div class="lempty">${esc(words.call.note)}</div>` : ""}${next(words.call, "call opening")}</div>
      </div>
    </div>
    <div class="learnfoot"><span>It all stays in your agency folder.</span><button type="button" class="btn solid" id="lnDone">Done</button></div>`
  $("#sheetBody").scrollTop = keepScroll
  $("#lnClose").onclick = closeSheet; $("#lnDone").onclick = closeSheet
  const save = async (body, okMsg) => { const r = await api("/api/learning/preference", body); if (r && r.ok !== false && !r.error) { if (okMsg) toast(okMsg); await loadLearning(); if (state.sel) loadSitePrefs(state.sel, true); return true } $("#lnMsg").textContent = (r && r.error) || "Not saved"; return false }
  for (const row of $$("#learned .lrow[data-pid]")) {
    const id = row.dataset.pid
    row.querySelector(".tog").onclick = (e) => { const on = e.currentTarget.getAttribute("aria-checked") !== "true"; e.currentTarget.setAttribute("aria-checked", on ? "true" : "false"); row.classList.toggle("off", !on); save({ id, on }, on ? "On: the next builds use it" : "Off: the next builds won't use it") }
    row.querySelector("[data-del]").onclick = () => save({ id, delete: true }, "Deleted: the agency won't use it again")
    row.querySelector("[data-edit]").onclick = () => {
      const p = (state.learning.preferences || []).find((x) => x.id === id); if (!p || row.querySelector(".edit")) return
      const ed = document.createElement("form"); ed.className = "edit"
      ed.innerHTML = `<input type="text" maxlength="200" value="${esc(p.text)}" aria-label="Its words"><button class="btn sm" type="submit">Save</button><button class="btn sm quiet" type="button">Cancel</button><span class="msg bad" role="alert"></span>`
      row.append(ed); const inp = ed.querySelector("input"); inp.focus(); inp.select()
      ed.querySelector("button[type=button]").onclick = () => ed.remove()
      ed.onsubmit = async (e) => { e.preventDefault(); const r = await api("/api/learning/preference", { id, text: inp.value }); if (r && !r.error) { toast("Saved in your words"); await loadLearning() } else { ed.querySelector(".msg").textContent = (r && r.error) || "Not saved"; inp.setAttribute("aria-invalid", "true"); inp.focus() } }
    }
  }
  $("#lnAdd").onsubmit = async (e) => { e.preventDefault(); const t = $("#lnAddText").value.trim(); if (!t) { $("#lnMsg").textContent = "Write it first, in a few words."; $("#lnAddText").focus(); return } if (await save({ text: t }, "Added: the next builds use it")) { const i = $("#lnAddText"); if (i) i.focus() } }
}

/* ───────── live ───────── */
function connect() {
  const ev = new EventSource("/events")
  ev.onopen = () => { if (serverGone) { serverGone = false; $("#banner").hidden = true } }
  ev.onerror = () => { if (!serverGone) { serverGone = true; $("#banner").textContent = "Server stopped. Start it again with npm run backoffice (or npm run sandbox)."; $("#banner").hidden = false } }
  const pending = new Set(); let t = null
  const flush = () => {
    const p = new Set(pending); pending.clear(); t = null
    if (p.has("sites") || p.has("refill-done")) loadSites()
    if (p.has("batches")) { loadBatches(); loadJobs(); if (state.view === "prospects") loadProspects() }
    if (p.has("prospects") && state.view === "prospects") loadProspects()
    if ((p.has("sales") || p.has("agent")) && state.view === "outreach") loadOutreach()
    if (p.has("cage") || p.has("machine")) loadCage()
    if (p.has("agency")) api("/api/agency").then((a) => { state.agency = a; setLocale(a); setPlaceholder(); rerender() })
    if (p.has("learning")) { loadLearning(); if (state.sel) loadSitePrefs(state.sel, true) }
  }
  ev.onmessage = (e) => {
    let d; try { d = JSON.parse(e.data) } catch { return }
    if (d.type === "job") { onJobEvent(d); if (d.status === "done" || d.status === "error") { pending.add("batches"); pending.add("sites"); pending.add("prospects") } }
    // what the agency took from your feedback, once read on the subscription (the sandbox answers at once instead)
    else if (d.type === "learning" && d.undo) {
      for (const t of Object.values(state.thread || {})) if (t.remember && t.remember.undo === d.undo) { t.remember = { ...(d.remember || {}), undo: (d.remember && d.remember.undo) || d.undo, pending: false }; renderThread() }
      markFresh(d.remember)
      pending.add("learning")
    }
    else pending.add(d.type)
    if (!t) t = setTimeout(flush, 250)
  }
}
setInterval(() => { if ([...jobs.rows.values()].some((j) => j.status === "queued" || j.status === "running")) { loadJobs(); if (state.view === "prospects") loadProspects(); if (state.view === "sites") { loadSites(); loadBatches() } } }, 5000)

/* ───────── boot ───────── */
route()
loadSites(); loadBatches(); loadCage(); loadJobs()
// the trades' names and the agency's locale first, then everything on screen is written with them (no raw key, no
// phone grouped the wrong way because a render came before the locale)
Promise.all([api("/api/trades"), api("/api/agency"), api("/api/agent")]).then(([m, a, ag]) => {
  if (m && typeof m === "object") for (const [k, v] of Object.entries(m)) if (typeof v === "string") TRADE[k] = v[0].toUpperCase() + v.slice(1)
  if (a && a.country) { state.agency = a; setLocale(a) }
  if (ag && ag.mode) state.agent = ag
  setPlaceholder(); loadProspects(); rerender(); loadLearning()
})
// no form over the product on first visit : one line under the header while the agency is the demo one
// and, in your own cockpit, one line when the AI that builds the sites is not connected (before you Find and Build)
api("/api/settings").then((st) => { if (st && !st.error) { state.settings = st; renderDemoBar(); renderAiBar() } })
$("#menuHandsoff").onclick = (e) => { e.preventDefault(); openHandsoff(); setMenu(false) }
connect()
