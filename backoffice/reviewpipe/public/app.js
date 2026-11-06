// Last Web Studios · cockpit. Three steps, left to right: Prospects → Sites → Outreach. A few sheets.
import { setLocale, place, phone as fmtPhone, telHref, owner, date as fmtDate, dateTime, slots } from "/locale.js"
const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const enc = encodeURIComponent
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
async function api(path, body) {
  const opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  try { const r = await fetch(path, opt); return await r.json().catch(() => ({})) } catch { return {} }
}
/* ───────── feedback: toast, loading buttons, job strip ───────── */
function toast(msg, bad = false) { const t = document.createElement("div"); t.className = "toast" + (bad ? " bad" : ""); t.textContent = msg; $("#toasts").appendChild(t); setTimeout(() => t.remove(), bad ? 5000 : 2600) }
/** optimistic click: the button spins at once, then the promise decides */
async function busy(btn, fn) { if (!btn || btn.classList.contains("loading")) return; btn.classList.add("loading"); try { return await fn() } finally { btn.classList.remove("loading") } }
const jobs = { rows: new Map(), live: new Map() }
async function loadJobs() { const r = await api("/api/jobs"); if (!r || !r.jobs) return; jobs.rows = new Map(r.jobs.map((j) => [j.id, j])); renderJobs() }
function jobTitle(j) {
  const p = j.params || {}
  if (j.mode === "find") { const what = (p.trades || []).map(trade).join(", ") || "a mix of trades"; return `Finding ${what}${p.place ? ` near ${p.place}` : ""}` }
  if (j.mode === "composer") return p.ids && p.ids.length ? `Building ${p.ids.length === 1 ? siteNameOf(p.ids[0]) : `${p.ids.length} sites`}` : `Building ${j.params && j.params.count ? j.params.count : ""} site(s)`
  if (j.mode === "edit") return `Applying your feedback${p.id ? ` on ${siteNameOf(p.id)}` : ""}`
  if (j.mode === "research") return "Preparing the call script"
  return j.mode
}
function siteNameOf(id) { const p = state.prospectsData && state.prospectsData.items.find((x) => x.id === id); return p ? p.name : (state.leads[id] && state.leads[id].name) || id.replace(/-/g, " ") }
function renderJobs() {
  const all = [...jobs.rows.values()].map((j) => ({ ...j, ...(jobs.live.get(j.id) || {}) }))
  const html = (filter) => all.filter(filter).map((j) => {
    const done = j.status === "done", err = j.status === "error", queued = j.status === "queued"
    const title = jobTitle(j)
    let line = err ? (j.error || "failed") : done ? (j.text || "done") : queued ? "waiting its turn" : (j.text || "running") // never a raw log line
    if (line.startsWith(title)) line = line.slice(title.length).replace(/^\s*[·:-]\s*/, "") || "running"
    const pct = done ? 100 : typeof j.pct === "number" ? j.pct : null
    return `<div class="job" data-job="${j.id}"><span class="t">${esc(title)}</span><span class="s ${err ? "bad" : done ? "ok" : ""}">${esc(line)}</span>${done || err ? "" : `<span class="bar"><i class="${pct == null ? "indet" : ""}" style="${pct == null ? "" : `width:${pct}%`}"></i></span>`}</div>`
  }).join("")
  $("#jobs").innerHTML = html((j) => j.mode === "find" || j.mode === "composer")
  $("#jobsOut").innerHTML = html((j) => j.mode === "research")
}
function onJobEvent(d) {
  const prev = jobs.live.get(d.id) || {}
  jobs.live.set(d.id, { ...prev, ...d })
  if (!jobs.rows.has(d.id)) loadJobs(); else renderJobs()
  if (d.status === "done" && prev.status !== "done") {
    if (d.mode === "find") toast(`${d.found || 0} prospects found`)
    if (d.mode === "composer") toast("Site built — it's in Sites")
    if (d.mode === "edit") toast("Feedback applied")
    setTimeout(() => { jobs.rows.delete(d.id); jobs.live.delete(d.id); renderJobs() }, 12000)
  }
  if (d.status === "error") toast(d.text || "Something failed", true)
}
const TRADE = { pisciniste: "Pools", menuisier: "Joinery", cuisiniste: "Kitchens", paysagiste: "Landscaping", plombier: "Plumbing", electricien: "Electrical", couvreur: "Roofing", carreleur: "Tiling", peintre: "Painting", restaurant: "Restaurant", coiffeur: "Hair salon" }
const trade = (k) => TRADE[k] || (k ? k[0].toUpperCase() + k.slice(1).replace(/-/g, " ") : "")
api("/api/trades").then((m) => { if (m && typeof m === "object") for (const [k, v] of Object.entries(m)) if (!TRADE[k] && typeof v === "string") TRADE[k] = v[0].toUpperCase() + v.slice(1) })
const when = (ms) => { if (!ms) return ""; const d = (Date.now() - ms) / 60000; if (d < 1) return "now"; if (d < 60) return `${Math.round(d)} min ago`; if (d < 1440) return `${Math.round(d / 60)} h ago`; return `${Math.round(d / 1440)} d ago` }
const usd = (n) => n == null ? "—" : `$${Number(n).toFixed(2)}`

const state = {
  view: "prospects", sites: [], leads: {}, batches: [], sel: null, viewMode: "after", vp: "full", beforeFor: null,
  crm: null, stages: null, agent: null, agency: null, lead: null, ltab: "script", prospectsData: null, psel: new Set(), outreachCount: null, openId: null, cage: null, boardFilter: null,
}

/* ───────── header, routing ───────── */
const VIEWS = ["prospects", "sites", "outreach"]
function route() {
  const h = (location.hash || "#prospects").slice(1)
  if (h === "settings") { openSettings(); return }
  state.view = VIEWS.includes(h) ? h : h === "pipeline" ? "outreach" : "prospects"
  for (const v of VIEWS) $(`#v-${v}`).hidden = state.view !== v
  $$("#steps a").forEach((a) => a.classList.toggle("on", a.dataset.v === state.view))
  if (state.view === "outreach") loadOutreach(); else state.boardFilter = null
  if (state.view === "prospects") loadProspects()
}
window.addEventListener("hashchange", route)
$("#menuBtn").onclick = (e) => { e.stopPropagation(); $("#menuDrop").hidden = !$("#menuDrop").hidden }
document.addEventListener("click", () => { $("#menuDrop").hidden = true })
function renderCounts() {
  const p = state.prospectsData, sites = state.sites || []
  $("#nProspects").textContent = p ? String(p.counts.new) : ""
  const waiting = sites.filter((x) => stateOf(x) === "new").length
  $("#nSites").textContent = sites.length ? String(waiting || sites.length) : ""
  $("#nOutreach").textContent = state.outreachCount != null ? String(state.outreachCount) : ""
}

/* ───────── sheets ───────── */
function openSheet(html) { $("#sheetBody").innerHTML = html; $("#sheet").hidden = false; $("#scrim").hidden = false; const f = $("#sheet input, #sheet button.primary"); if (f) f.focus() }
function closeSheet() { $("#sheet").hidden = true; $("#scrim").hidden = true; if (location.hash === "#settings") history.replaceState(null, "", "#" + state.view) }
$("#scrim").onclick = closeSheet
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeSheet(); closeLead() } })

async function openSettings() {
  const [agent, agency] = await Promise.all([api("/api/agent"), api("/api/agency")])
  state.agent = agent; state.agency = agency
  const modes = [["sequencer", "Email automation", state.cage && state.cage.send.mode !== "dry-run" ? `<span class="chip approved">live</span>` : `<span class="chip">paused</span>`], ["webhook", "Your own agent (webhook)", ""], ["manual", "I do it myself", ""]]
  openSheet(`<h2>Settings</h2>
    <div class="kv"><span class="k">Agency</span><b>${esc(agency.name || "—")}</b></div>
    <div class="field">After you approve a site
      <div class="radios" id="modes">${modes.map(([k, l, x]) => `<label class="radio ${agent.mode === k ? "on" : ""}"><input type="radio" name="mode" value="${k}" ${agent.mode === k ? "checked" : ""}><b>${l}</b>${x}</label>`).join("")}</div>
      <input id="aUrl" type="url" placeholder="https://your-agent.example/hook" value="${esc(agent.url || "")}" ${agent.mode === "webhook" ? "" : "hidden"}>
      <span class="msg">On approve, the prospect, the site and the call script are posted there.</span>
    </div>
    <label class="field">Describe your agency in one paragraph <textarea id="brandText" placeholder="Who you are, who you work with, what you promise.">${esc((agency.brand && agency.brand.team) || "")}</textarea><span class="msg">Used in the emails and the call scripts.</span></label>
    <div class="actions"><button class="btn primary" id="aSave">Save</button><button class="btn ghost" id="aCancel">Cancel</button><span class="msg" id="aMsg"></span></div>`)
  $$("#modes input").forEach((i) => i.onchange = () => { $$("#modes .radio").forEach((r) => r.classList.toggle("on", r.contains(i))); $("#aUrl").hidden = i.value !== "webhook" })
  $("#aCancel").onclick = closeSheet
  $("#aSave").onclick = () => busy($("#aSave"), async () => {
    const mode = ($("#modes input:checked") || {}).value
    const r = await api("/api/agent", { mode, url: $("#aUrl").value.trim() })
    if (!r.ok) { $("#aMsg").textContent = r.error || "Not saved"; return }
    const bt = $("#brandText").value.trim()
    if (bt && bt !== ((state.agency && state.agency.brand && state.agency.brand.team) || "")) { const b = await api("/api/agency/brand", { text: bt }); if (!b.ok) { $("#aMsg").textContent = b.error || "Agency not saved"; return } }
    state.agent = r; closeSheet(); renderAgent(); toast("Saved")
  })
}

function openCage() {
  const c = state.cage; if (!c) return
  const b = c.breaker, rate = (x) => `${(Math.round((x || 0) * 1000) / 10)}%`
  const th = { bounce: 1, complaint: 0.1, unsub: 2 }
  openSheet(`<h2>${c.stop.on ? "Paused" : "Running"}</h2>
    ${c.stop.on ? `<span class="msg bad">${esc(c.stop.reason || "Paused by you")}</span>` : ""}
    <div class="rows">
      <div class="row"><span class="k">Spend today</span><span class="bar"><i class="${c.budget.reached ? "bad" : ""}" style="width:${c.budget.capUsd ? Math.min(100, (c.budget.spentUsd / c.budget.capUsd) * 100) : 0}%"></i></span><b>${usd(c.budget.spentUsd)} / ${c.budget.capUsd ? usd(c.budget.capUsd) : "no cap"}</b></div>
      ${b ? ["bounce", "complaint", "unsub"].map((k) => `<div class="row"><span class="k">${{ bounce: "Bounces", complaint: "Complaints", unsub: "Unsubscribes" }[k]}</span><span class="bar"><i class="${(b.rates[k] || 0) * 100 > th[k] ? "bad" : ""}" style="width:${Math.min(100, ((b.rates[k] || 0) * 100 / th[k]) * 100)}%"></i></span><b>${rate(b.rates[k])} <span class="muted">/ ${th[k]}%</span></b></div>`).join("") : ""}
      <div class="row"><span class="k">Email sending</span><b>${c.send.mode === "dry-run" ? "paused (nothing goes out)" : "live"}</b></div>
      ${b && b.open ? `<div class="row"><span class="k">Safety limit</span><b class="msg bad">reached, sending stopped</b></div>` : ""}
    </div>
    <div class="actions">
      <button class="btn ${c.stop.on ? "primary" : "danger"}" id="cStop">${c.stop.on ? "Resume" : "Pause everything"}</button>
      ${b && b.open ? `<button class="btn ghost" id="cReset">Lift the safety limit</button>` : ""}
      <button class="btn ghost" id="cClose">Close</button>
    </div>`)
  $("#cClose").onclick = closeSheet
  $("#cStop").onclick = async () => {
    const on = !c.stop.on
    const reason = on ? (prompt("Reason (optional)") ?? "") : ""
    const r = await api("/api/cage/stop", { on, reason })
    if (r.ok) { closeSheet(); loadCage() }
  }
  const rs = $("#cReset"); if (rs) rs.onclick = async () => { await api("/api/cage/breaker/reset"); closeSheet(); loadCage() }
}

function openStages() {
  const s = state.stages; if (!s) return
  const rows = [...s.hot, ...s.closing].map((x) => `<label class="field">${esc(x.key)} <input type="text" data-k="${x.key}" value="${esc(x.label)}" maxlength="40"></label>`).join("")
  openSheet(`<h2>Edit steps</h2><div class="rows">${rows}</div>
    <div class="actions"><button class="btn primary" id="sSave">Save</button><button class="btn ghost" id="sCancel">Cancel</button></div>`)
  $("#sCancel").onclick = closeSheet
  $("#sSave").onclick = async () => {
    const labels = {}; $$("#sheet input[data-k]").forEach((i) => { labels[i.dataset.k] = i.value })
    const r = await api("/api/crm/stages", { labels })
    if (r.ok) { state.stages = { hot: r.hot, closing: r.closing }; closeSheet(); renderBoard() }
  }
}

/* ───────── prospects ───────── */
const STATUS_P = { new: "New", building: "Building", built: "Built", skipped: "Skipped" }
async function loadProspects() {
  const d = await api("/api/prospects")
  if (!d || !d.items) return
  state.prospectsData = d
  $("#autoToggle").checked = !!d.automatic
  $("#autoHint").textContent = d.automatic ? "New good prospects get built without asking you. You still approve each site." : "You decide each step."
  $("#tradeList").innerHTML = d.trades.map((t) => `<option value="${esc(trade(t))}">`).join("")
  for (const [sel, list, label, all] of [["#fTrade", d.trades, trade, "All trades"], ["#fCity", d.cities, (x) => x, "All cities"]]) {
    const el = $(sel), cur = el.value
    el.innerHTML = `<option value="">${all}</option>` + list.map((x) => `<option value="${esc(x)}">${esc(label(x))}</option>`).join("")
    el.value = cur
  }
  renderProspects(); renderCounts()
}
function prospectCard(x, sel) {
  return `<div class="thumb" title="Their current site">${x.hasBefore ? `<img src="/avant/${enc(x.id)}" alt="" loading="lazy">` : `<span class="nopic">no capture</span>`}${x.status === "new" ? `<input type="checkbox" data-sel="${esc(x.id)}" ${sel.has(x.id) ? "checked" : ""} aria-label="Select">` : ""}</div>
      <div class="body">
        <div class="head"><div><div class="name">${esc(x.name)}</div><div class="sub">${esc([trade(x.industry), place(x.city, x.region, x.zip)].filter(Boolean).join(" · "))}</div></div><span class="chip ${x.status === "built" ? "approved" : x.status}">${STATUS_P[x.status]}</span></div>
        ${x.reasons.length ? `<ul class="why">${x.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
        <div class="foot">
          ${x.fit ? `<span class="chip fit">Good fit</span>` : ""}
          <span class="muted">${x.phone ? esc(fmtPhone(x.phone)) : "no phone"}${x.email ? " · email" : ""}</span>
          <span class="spacer"></span>
          ${x.status === "new" ? `<button class="btn primary" data-build="${esc(x.id)}">Build site</button><button class="btn ghost" data-skip="${esc(x.id)}">Skip</button>` : ""}
          ${x.status === "built" && x.site ? `<a class="btn ghost" href="#sites" data-open="${esc(x.id)}">See site</a>` : ""}
          ${x.status === "skipped" ? `<button class="btn ghost" data-unskip="${esc(x.id)}">Undo</button>` : ""}
          ${x.oldUrl ? `<a class="btn ghost" href="${esc(x.oldUrl)}" target="_blank" rel="noopener">Their site</a>` : ""}
        </div>
      </div>`
}
/** the list is updated IN PLACE, keyed by id: a card that is being clicked is never replaced under the pointer */
function renderProspects() {
  const d = state.prospectsData; if (!d) return
  const ft = $("#fTrade").value, fc = $("#fCity").value, fs = $("#fStatus").value
  const items = d.items.filter((x) => (!ft || x.industry === ft) && (!fc || x.city === fc) && (!fs || x.status === fs))
  const sel = state.psel || new Set()
  const list = $("#plist")
  if (!items.length) { list.innerHTML = d.items.length ? `<div class="empty">Nothing matches these filters.</div>` : `<div class="hero"><b>Tell the agency what you're after</b><span>It finds local businesses with a dated website, in your words: a trade, a place, how many — or “surprise me”.</span></div>`; state.knownIds = new Set(); renderBulk(); return }
  if (list.querySelector(".empty, .hero")) list.innerHTML = ""
  const keep = new Set(items.map((x) => x.id))
  for (const el of [...list.children]) if (!keep.has(el.dataset.id)) el.remove()
  let prev = null
  for (const x of items) {
    let el = list.querySelector(`.pc[data-id="${CSS.escape(x.id)}"]`)
    const html = prospectCard(x, sel), cls = `pc ${x.status} ${sel.has(x.id) ? "sel" : ""}`
    if (!el) { el = document.createElement("article"); el.dataset.id = x.id; el.className = cls + (state.knownIds ? " enter" : ""); el.innerHTML = html; el.dataset.sig = html }
    else if (el.dataset.sig !== html) { el.innerHTML = html; el.dataset.sig = html; el.className = cls }
    else el.className = cls
    if (prev ? prev.nextSibling !== el : list.firstChild !== el) list.insertBefore(el, prev ? prev.nextSibling : list.firstChild)
    prev = el
  }
  state.knownIds = new Set(d.items.map((x) => x.id))
  renderBulk()
}
// one listener for every card action (delegation: survives re-renders)
$("#plist").addEventListener("click", (e) => {
  const b = e.target.closest("[data-build],[data-skip],[data-unskip],[data-open]"); if (!b) return
  if (b.dataset.build) buildIds([b.dataset.build], b)
  else if (b.dataset.skip) busy(b, async () => { const r = await api("/api/prospects/skip", { id: b.dataset.skip, on: true }); if (r.ok) toast("Skipped"); else toast(r.error || "Not saved", true); await loadProspects() })
  else if (b.dataset.unskip) busy(b, async () => { await api("/api/prospects/skip", { id: b.dataset.unskip, on: false }); await loadProspects() })
  else if (b.dataset.open) state.openId = b.dataset.open
})
$("#plist").addEventListener("change", (e) => {
  const c = e.target.closest("[data-sel]"); if (!c) return
  const sel = state.psel || new Set(); if (c.checked) sel.add(c.dataset.sel); else sel.delete(c.dataset.sel); state.psel = sel; renderBulk(); c.closest(".pc").classList.toggle("sel", c.checked)
})
function renderBulk() { const n = (state.psel || new Set()).size; $("#bulk").hidden = !n; $("#bulkCount").textContent = `${n} selected` }
async function buildIds(ids, btn) {
  return busy(btn, async () => {
    const r = await api("/api/batch", { mode: "composer", ids, limit: ids.length, note: "from Prospects" })
    if (!r.ok) { toast(r.error || "Could not start the build", true); return }
    toast(ids.length === 1 ? `Building ${siteNameOf(ids[0])}` : `Building ${ids.length} sites`)
    for (const id of ids) { const it = state.prospectsData && state.prospectsData.items.find((x) => x.id === id); if (it) it.status = "building" }
    state.psel = new Set(); renderProspects(); renderCounts(); loadJobs(); loadBatches()
  })
}
$("#bulkBuild").onclick = (e) => buildIds([...(state.psel || [])], e.currentTarget)
$("#bulkClear").onclick = () => { state.psel = new Set(); renderProspects() }
$$("#fTrade, #fCity, #fStatus").forEach((el) => el.onchange = renderProspects)
$("#autoToggle").onchange = async (e) => {
  const on = e.target.checked
  $("#autoHint").textContent = on ? "New good prospects get built without asking you. You still approve each site." : "You decide each step."
  const r = await api("/api/automatic", { on })
  if (r.automatic === undefined) { e.target.checked = !on; toast(r.error || "Not saved", true) } else toast(on ? "Hands-off is on" : "Hands-off is off")
}
const BRIEF = { text: "", data: null, timer: null }
function renderBrief(b) {
  const box = $("#briefChips"); if (!b) { box.hidden = true; box.innerHTML = ""; return }
  const chips = [...(b.trades || []).map((t) => `<span class="chip">${esc(trade(t))}</span>`), b.place ? `<span class="chip">${esc(b.place)}${b.country ? `, ${esc(b.country)}` : ""}</span>` : (b.country ? `<span class="chip">${esc(b.country)}</span>` : ""), `<span class="chip">${b.count}</span>`, b.mix ? `<span class="chip">mix</span>` : ""]
  const unknown = (b.unmatched || []).length ? ` <span class="muted">· ${esc(b.unmatched.join(", "))}: not a trade the agency knows yet</span>` : ""
  box.innerHTML = `<span>The agency understood:</span> ${chips.join(" ")} <span class="chip edit" id="briefEdit">edit</span>${unknown}`
  box.hidden = false
  $("#briefEdit").onclick = () => openBriefEdit(b)
}
function openBriefEdit(b) {
  openSheet(`<h2>What to look for</h2>
    <label class="field">Trades (comma separated) <input id="eTrades" type="text" value="${esc((b.trades || []).map(trade).join(", "))}"></label>
    <label class="field">Where <input id="ePlace" type="text" value="${esc(b.place || "")}"></label>
    <label class="field">Country <input id="eCountry" type="text" value="${esc(b.country || "")}" maxlength="2"></label>
    <label class="field">How many <input id="eCount" type="number" min="1" max="200" value="${b.count || 10}"></label>
    <div class="actions"><button class="btn primary" id="eGo">Find</button><button class="btn ghost" id="eCancel">Cancel</button></div>`)
  $("#eCancel").onclick = closeSheet
  $("#eGo").onclick = () => busy($("#eGo"), async () => {
    const names = $("#eTrades").value.split(",").map((x) => x.trim()).filter(Boolean)
    const keys = names.map((n) => Object.entries(TRADE).find(([k, v]) => v.toLowerCase() === n.toLowerCase())?.[0] || n.toLowerCase())
    closeSheet()
    await startFind({ trades: keys, place: $("#ePlace").value.trim(), country: $("#eCountry").value.trim().toUpperCase(), count: Number($("#eCount").value) || 10, mix: !keys.length })
  })
}
async function startFind(payload) {
  const r = await api("/api/prospects/find", payload)
  if (!r.ok) { toast(r.error || "Could not start", true); return }
  BRIEF.data = r.brief; renderBrief(r.brief)
  toast("Looking for prospects")
  jobs.rows.set(r.id, { id: r.id, mode: "find", status: "queued", params: r.brief }); renderJobs(); loadJobs()
}
$("#findText").addEventListener("input", () => { clearTimeout(BRIEF.timer); const text = $("#findText").value.trim(); if (!text) { renderBrief(null); return } BRIEF.timer = setTimeout(async () => { const b = await api("/api/brief", { text }); if (b && b.trades && $("#findText").value.trim() === text) renderBrief(b) }, 400) })
$("#findForm").onsubmit = (e) => { e.preventDefault(); const text = $("#findText").value.trim(); if (!text) { $("#findText").focus(); return } busy($("#findBtn"), () => startFind({ text })) }
$("#howtoClose").onclick = () => { $("#howto").hidden = true; try { localStorage.setItem("lws.howto", "1") } catch { /* */ } }
try { if (!localStorage.getItem("lws.howto")) $("#howto").hidden = false } catch { /* */ }
async function loadCage() { const c = await api("/api/cage"); if (c && c.stop) renderCage(c) }
function renderCage(c) {
  state.cage = c
  const p = $("#cagePill")
  p.className = "pill" + (c.stop.on ? " stop" : c.alerts && c.alerts.length ? " warn" : "")
  p.innerHTML = `<span class="dot"></span><span class="label">${c.stop.on ? "Paused" : "Running"}</span><span class="budget"><span class="muted">·</span> ${usd(c.budget.spentUsd)}${c.budget.capUsd ? ` of ${usd(c.budget.capUsd)} today` : " today"}</span>`
}
$("#cagePill").onclick = openCage

/* ───────── sites ───────── */
async function loadSites() {
  const [sites, leads] = await Promise.all([api("/api/sites"), api("/api/leads")])
  state.sites = Array.isArray(sites) ? sites.filter((s) => s.hasIndex !== false) : []
  state.leads = {}; for (const p of (leads && leads.prospects) || []) state.leads[p.id] = p
  renderRail()
  if (!state.sel && state.sites.length) selectSite(state.sites[0])
  if (state.openId) { const o = state.sites.find((s) => s.id === state.openId); state.openId = null; if (o) selectSite(o) }
  if (state.sel) { const cur = state.sites.find((s) => s.id === state.sel.id && s.date === state.sel.date); if (cur) { state.sel = cur; renderInspect() } }
  renderCounts()
  $("#emptyStage").hidden = state.sites.length > 0
}
async function loadBatches() { const r = await api("/api/batches"); state.batches = (r && r.batches) || []; renderRail(); renderInspect() }
function buildState(id) {
  for (const b of state.batches) {
    if (!["queued", "running"].includes(b.status) || b.mode !== "composer") continue
    let ids = []; try { ids = JSON.parse(b.params_json || "{}").ids || [] } catch { /* */ }
    if (ids.includes(id)) return b.status === "running" ? "building" : "queued"
  }
  return null
}
function stateOf(s) {
  const b = buildState(s.id); if (b) return b
  return { approved: "approved", rejected: "rejected", sent: "contacted", drafted: "contacted", superseded: "old" }[s.status] || "new"
}
const STATE_LABEL = { new: "Waiting for you", approved: "In outreach", rejected: "Skipped", contacted: "In outreach", queued: "Building", building: "Building", old: "Old" }
function siteName(s) { return s.name || (state.leads[s.id] && state.leads[s.id].name) || s.id.replace(/-/g, " ") }
function siteSub(s) { const l = state.leads[s.id] || {}; return [trade(l.industry), place(s.city || l.city, l.region, l.zip)].filter(Boolean).join(" · ") }
function renderRail() {
  const rail = $("#rail")
  if (!state.sites.length) { rail.innerHTML = `<div class="empty">No sites yet</div>`; return }
  rail.innerHTML = state.sites.map((s) => {
    const st = stateOf(s), on = state.sel && state.sel.id === s.id && state.sel.date === s.date
    return `<a class="card ${on ? "on" : ""}" data-id="${esc(s.id)}" data-date="${esc(s.date)}">
      <div class="name"><span>${esc(siteName(s))}</span><span class="chip ${st}">${STATE_LABEL[st]}</span></div>
      <div class="sub"><span>${esc(siteSub(s))}</span><span class="date">${esc(s.date.slice(0, 10))}</span></div></a>`
  }).join("")
  $$("#rail .card").forEach((c) => c.onclick = () => { const s = state.sites.find((x) => x.id === c.dataset.id && x.date === c.dataset.date); if (s) selectSite(s) })
}
function selectSite(s) {
  state.sel = s
  $("#preview").src = `/preview/${enc(s.id)}/${enc(s.date)}/index.html`
  state.beforeFor = null
  setView(state.viewMode === "before" ? "before" : state.viewMode)
  renderRail(); renderInspect(); loadComment()
}
function renderInspect() {
  const s = state.sel
  if (!s) { $("#iTitle").textContent = "—"; $("#iScore").hidden = true; $("#iState").textContent = ""; $("#iMeta").textContent = ""; return }
  const st = stateOf(s), l = state.leads[s.id] || {}
  $("#iTitle").textContent = siteName(s)
  const tier = s.oppTier ?? l.oppTier
  $("#iScore").hidden = !(tier === "hot" || tier === "warm")
  $("#iState").className = `chip ${st}`; $("#iState").textContent = STATE_LABEL[st]
  $("#iMeta").textContent = siteSub(s)
  $("#approve").disabled = st === "approved" || st === "building" || st === "queued"
  $("#rebuild").disabled = st === "building" || st === "queued"
}
async function setStatus(status, btn) {
  const s = state.sel; if (!s) return
  return busy(btn, async () => {
    const r = await api("/api/status", { id: s.id, date: s.date, status })
    if (r.ok) { s.status = status; renderRail(); renderInspect(); renderCounts(); toast(status === "approved" ? "Sent to outreach" : "Skipped"); if (status === "approved") state.outreachCount = (state.outreachCount || 0) + 1, renderCounts() }
    else toast(r.error || "Not saved", true)
  })
}
$("#approve").onclick = (e) => setStatus("approved", e.currentTarget)
$("#reject").onclick = (e) => setStatus("rejected", e.currentTarget)
$("#rebuild").onclick = (e) => busy(e.currentTarget, async () => {
  const s = state.sel; if (!s) return
  const r = await api("/api/batch", { mode: "composer", ids: [s.id], limit: 1, force: true, note: "rebuild from the cockpit" })
  if (r.ok) { toast(`Rebuilding ${siteName(s)}`); loadJobs(); loadBatches() } else toast(r.error || "Could not start", true)
})
async function loadComment() {
  const s = state.sel; if (!s) return
  const d = await api(`/api/control?id=${enc(s.id)}&date=${enc(s.date)}`)
  $("#comment").value = (d && d.control && d.control.comment) || ""
  $("#iMsg").textContent = ""
}
$("#apply").onclick = (e) => busy(e.currentTarget, async () => {
  const s = state.sel; if (!s) return
  if (!$("#comment").value.trim()) { toast("Write what should change first", true); $("#comment").focus(); return }
  await api(`/api/control?id=${enc(s.id)}&date=${enc(s.date)}`, { comment: $("#comment").value })
  const r = await api("/api/refill", { id: s.id, date: s.date })
  if (r.ok) { toast("The agent is applying your feedback"); loadJobs(); loadBatches() } else toast(r.error || "Could not apply", true)
})
$("#comment").addEventListener("paste", async (e) => {
  const s = state.sel; if (!s) return
  const f = [...(e.clipboardData && e.clipboardData.files || [])].find((x) => x.type.startsWith("image/")); if (!f) return
  e.preventDefault()
  const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f) })
  const r = await api("/api/upload", { id: s.id, date: s.date, name: f.name || "paste.png", dataUrl: data })
  if (r.file) { const ta = $("#comment"); ta.value += `\n![screenshot](${r.file})`; ta.dispatchEvent(new Event("input")) }
})

function setView(mode) {
  if (!state.sel) return
  state.viewMode = mode
  if (mode === "before" && state.beforeFor !== state.sel.id) {
    state.beforeFor = state.sel.id
    const box = $("#before"); box.innerHTML = ""
    const img = new Image(); img.onerror = () => { box.innerHTML = `<div class="empty">No capture of the old site</div>` }; img.src = `/avant/${enc(state.sel.id)}`; box.appendChild(img)
  }
  $("#before").hidden = mode !== "before"
  $("#compare").hidden = mode !== "compare"
  $("#viewport").style.visibility = mode === "before" ? "hidden" : "visible"
  $$("#viewmode a").forEach((a) => a.classList.toggle("on", a.dataset.v === mode))
  $("#openTab").href = mode === "before" ? `/avant/${enc(state.sel.id)}` : `/preview/${enc(state.sel.id)}/${enc(state.sel.date)}/index.html`
  if (mode === "compare") buildCompare()
}
function buildCompare() {
  const cmp = $("#compare"), id = state.sel.id
  cmp.innerHTML = `<div class="cbefore" id="cbefore"><img src="/avant/${enc(id)}" alt="before"></div><div class="chandle" id="chandle"></div>`
  const setX = (frac) => { frac = Math.max(0, Math.min(1, frac)); const w = cmp.clientWidth; $("#cbefore").style.width = frac * 100 + "%"; $("#chandle").style.left = frac * w + "px"; const img = cmp.querySelector("img"); if (img) img.style.width = w + "px" }
  setX(0.5)
  const move = (e) => { const r = cmp.getBoundingClientRect(); const cx = e.touches ? e.touches[0].clientX : e.clientX; setX((cx - r.left) / r.width) }
  const stop = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", stop); document.removeEventListener("touchmove", move); document.removeEventListener("touchend", stop) }
  const start = (e) => { e.preventDefault(); document.addEventListener("mousemove", move); document.addEventListener("mouseup", stop); document.addEventListener("touchmove", move); document.addEventListener("touchend", stop) }
  const h = $("#chandle"); h.addEventListener("mousedown", start); h.addEventListener("touchstart", start, { passive: false })
}
$$("#viewmode a").forEach((a) => a.onclick = () => setView(a.dataset.v))
$$("#vpsel a").forEach((a) => a.onclick = () => { state.vp = a.dataset.w; $("#viewport").style.width = a.dataset.w === "full" ? "100%" : a.dataset.w + "px"; $$("#vpsel a").forEach((x) => x.classList.toggle("on", x === a)) })

/* ───────── pipeline ───────── */
async function loadOutreach() {
  const [crm, stages, agent] = await Promise.all([api("/api/crm"), api("/api/crm/stages"), api("/api/agent")])
  state.crm = crm && crm.hot ? crm : { hot: {}, closing: {} }
  state.outreachCount = allLeads().filter((l) => l.pipeline === "hot" && l.stage !== "nurturing").length; renderCounts()
  state.stages = stages && stages.hot ? stages : null
  state.agent = agent
  renderAgent(); renderBoard()
  if (state.lead) { const l = findLead(state.lead.id); if (l) { state.lead = l; renderLead() } }
}
function renderAgent() {
  const a = state.agent || { mode: "sequencer" }
  const label = { sequencer: "Email automation", webhook: "Your own agent", manual: "You do it yourself" }[a.mode] || a.mode
  const badge = a.mode === "sequencer" && state.cage ? `<span class="chip ${state.cage.send.mode === "dry-run" ? "" : "approved"}">${state.cage.send.mode === "dry-run" ? "paused" : "live"}</span>` : a.mode === "webhook" ? `<span class="muted">${esc(a.url)}</span>` : ""
  $("#agentLine").innerHTML = `After approval: <b>${label}</b> ${badge} <a href="#settings">Change</a>`
}
function allLeads() { const c = state.crm || {}; return [...Object.values(c.hot || {}), ...Object.values(c.closing || {})].flat() }
function findLead(id) { return allLeads().find((l) => l.id === id) }
function renderBoard() {
  const s = state.stages; const c = state.crm
  if (!s || !c) { $("#board").innerHTML = `<div class="hero"><b>Nothing to call yet</b><span>Approved sites land here, ready to call. <a href="#sites">Review your sites →</a></span></div>`; return }
  const col = (pipe, st, extra = "") => {
    const items = (c[pipe] && c[pipe][st.key]) || []
    return `<div class="col ${extra}"><div class="colhead"><span>${esc(st.label)}</span><i>${items.length}</i></div>
      ${items.length ? items.map(kcard).join("") : `<div class="empty">—</div>`}</div>`
  }
  const won = state.boardFilter === "won"
  const leadBtns = $$("#board [data-next]").length
  $("#board").innerHTML = (won ? "" : s.hot.map((st) => col("hot", st)).join("")) + s.closing.filter((st) => !won || st.key === "signature").map((st, i) => col("closing", st, i === 0 && !won ? "closing-start" : "")).join("")
  $("#boardFilter").innerHTML = won ? `<span class="chip approved">Clients</span> <a class="muted" href="#outreach" id="allLeads">Show everyone</a> · <a class="muted" href="/billing.html">Billing</a>` : ""
  const al = $("#allLeads"); if (al) al.onclick = (e) => { e.preventDefault(); state.boardFilter = null; renderBoard() }
  // (card clicks and Next step are delegated on #board: see below)
  if (!allLeads().length) $("#board").innerHTML = `<div class="hero"><b>Nothing to call yet</b><span>Approved sites land here, ready to call. <a href="#sites">Review your sites →</a></span></div>`
}
function mailDot(l) {
  const m = l.mail; if (!m) return `<span class="dot"></span>no email`
  if (m.status === "replied") return `<span class="dot ok"></span>replied`
  if (m.status === "active") return `<span class="dot ok"></span>email ${m.step + 1}/${m.total}${m.clicks ? " · clicked" : ""}`
  if (m.status === "waiting-content") return `<span class="dot warn"></span>email waiting`
  return `<span class="dot"></span>${m.status}`
}
function kcard(l) {
  return `<div class="kcard" data-id="${esc(l.id)}" data-act="call">
    <div class="name">${esc(l.name)}</div>
    <div class="sub">${esc([trade(l.industry), place(l.city, l.region, l.zip)].filter(Boolean).join(" · "))}</div>
    <div class="meta">${l.phone ? `<span>${esc(fmtPhone(l.phone))}</span>` : ""}<span>${mailDot(l)}</span>${l.rdvAt ? `<span>meeting ${fmtDate(l.rdvAt)}</span>` : ""}</div>
    ${nextStage(l) ? `<div class="meta"><button class="btn ghost" data-next="${esc(l.id)}">Next step →</button></div>` : ""}
  </div>`
}
$("#editStages").onclick = openStages
$("#board").addEventListener("click", (e) => {
  const nb = e.target.closest("[data-next]")
  if (nb) { e.stopPropagation(); const l = findLead(nb.dataset.next); if (!l) return; busy(nb, async () => { const r = await api("/api/crm/stage", { id: l.id, pipeline: l.pipeline, stage: nextStage(l) }); if (r.ok) toast(`${l.name} → ${(state.stages[l.pipeline].find((x) => x.key === nextStage(l)) || {}).label || "next step"}`); else toast(r.error || "Not moved", true); await loadOutreach() }); return }
  const k = e.target.closest(".kcard"); if (k) openLead(k.dataset.id)
})

/* ───────── call panel ───────── */
function openLead(id) { const l = findLead(id); if (!l) return; state.lead = l; state.ltab = "script"; renderLead() }
function closeLead() { state.lead = null; $("#lead").hidden = true; $("#lead").innerHTML = "" }
const ORDER = { hot: ["call0", "relance1", "relance2", "relance3", "nurturing"], closing: ["demo", "propal", "nego", "signature"] }
function stageLabel(l) { const s = state.stages; const st = s && s[l.pipeline] && s[l.pipeline].find((x) => x.key === l.stage); return st ? st.label : l.stage }
function nextStage(l) { const o = ORDER[l.pipeline] || ORDER.hot; const i = o.indexOf(l.stage); return i >= 0 && i < o.length - 1 ? o[i + 1] : null }
function baseScript(l) {
  const agency = (state.agency && state.agency.signature) || (state.agency && state.agency.name) || "our studio"
  const who = l.contact || owner()
  if (l.pipeline === "closing") return [`Meeting with ${l.name}`, "Walk through the new site next to the old one. Listen to what they need. Then the offer: install, price, timeline.", "On price: ask what a new customer is worth to them first, then the number."].join("\n\n")
  if (l.stage === "nurturing") return [`${l.name} is nurturing`, "No cold call. Light touches by email for two months; call again when they show interest."].join("\n\n")
  const open = /relance/.test(l.stage || "") ? `Hi, this is [your name] from ${agency}. I'm following up: I built a new website for ${l.name}, for free, and wanted to make sure you saw it.` : `Hi, this is [your name] from ${agency}. Am I speaking with ${who}?\n\nI build websites for ${trade(l.industry).toLowerCase() || "local"} businesses. I looked at yours and took the liberty of building a new one for ${l.name}, so you can see it already done.`
  return [open, "Could I show it to you in a 10-minute call this week?", "If yes: book the meeting. If they answered but not now: note it and plan the next step."].join("\n\n")
}
function renderLead() {
  const l = state.lead; if (!l) return
  const box = $("#lead"); box.hidden = false
  const tabs = [["script", "Script"], ["email", "Email"], ["history", `History${l.notes && l.notes.length ? ` ${l.notes.length}` : ""}`]]
  let body = ""
  if (state.ltab === "script") body = `<div class="script">${esc(l.callScript || baseScript(l))}</div>`
  else if (state.ltab === "email") {
    const m = l.mail
    body = m ? `<div class="kv"><span class="k">Status</span><b>${esc(m.status)}</b><span class="k">Step</span><span>${m.step + 1} / ${m.total}</span><span class="k">Sent</span><span>${m.sends}${m.lastSendAt ? ` · last ${when(new Date(m.lastSendAt).getTime())}` : ""}</span><span class="k">Clicks</span><span>${m.clicks}${m.lastClickAt ? ` · last ${when(new Date(m.lastClickAt).getTime())}` : ""}</span>${m.nextRunAt ? `<span class="k">Next</span><span>${dateTime(new Date(m.nextRunAt).getTime())}</span>` : ""}${m.waiting ? `<span class="k">Held</span><span>${esc(m.waiting.detail || m.waiting.reason)}</span>` : ""}</div>` : `<span class="muted">${l.email ? "Not in a sequence." : "No email address on their site."}</span>`
  } else {
    const notes = (l.notes || []).slice().reverse()
    body = notes.length ? `<div class="hist">${notes.map((n) => `<div class="h"><span class="k">${fmtDate(n.at)}</span><span><b>${esc({ note: "Note", rdv: "Meeting", lost: "Lost", reach: "Answered", unreach: "No answer" }[n.outcome] || n.outcome)}</b>${n.slot ? ` · ${esc((slots().find((x) => x[0] === n.slot) || [])[2] || n.slot)}` : ""}${n.text ? ` · ${esc(n.text)}` : ""}</span></div>`).join("")}</div>` : `<span class="muted">No calls yet.</span>`
  }
  const next = nextStage(l)
  box.innerHTML = `<div class="lhead"><div style="flex:1;min-width:0"><h2>${esc(l.name)}</h2><div class="sub">${esc([trade(l.industry), place(l.city, l.region, l.zip)].filter(Boolean).join(" · "))} · ${esc(stageLabel(l))}</div></div>
      ${l.phone ? `<a class="btn primary" href="${esc(telHref(l.phone))}">${esc(fmtPhone(l.phone))}</a>` : ""}
      <button class="btn icon" id="lClose" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
    <div class="lbody">
      ${l.insights && l.insights.length ? `<div><h3 class="sectitle">Insights</h3><ul class="insights">${l.insights.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
      <div class="actions"><a class="btn ghost" href="${esc(l.siteUrl)}" target="_blank" rel="noopener">New site</a>${l.oldUrl ? `<a class="btn ghost" href="${esc(l.oldUrl)}" target="_blank" rel="noopener">Old site</a>` : ""}</div>
      <form class="ask2" id="askForm"><div class="actions"><input id="askText" type="text" placeholder="Ask for a follow-up email or a call angle"><button class="btn ghost" id="askGo" type="submit">Ask</button></div><div class="out" id="askOut" hidden></div></form>
      <div class="ltabs" id="ltabs">${tabs.map(([k, t]) => `<a data-t="${k}" class="${state.ltab === k ? "on" : ""}">${t}</a>`).join("")}</div>
      <div id="lcontent">${body}</div>
    </div>
    <div class="lfoot">
      <textarea id="lNote" placeholder="Note"></textarea>
      <div class="actions">
        <button class="btn ghost" data-o="note">Note</button>
        ${next ? `<button class="btn ghost" data-o="next">Next step</button>` : ""}
        ${l.pipeline !== "closing" ? `<button class="btn ghost" data-o="meeting">Meeting</button>` : ""}
        <button class="btn danger" data-o="lost">Lost</button>
        ${l.stage !== "signature" ? `<button class="btn primary" data-o="won">Won</button>` : ""}
        <span class="msg" id="lMsg"></span>
      </div>
      <div id="lMeeting" hidden><div class="actions"><input id="lWhen" type="datetime-local"><button class="btn primary" id="lWhenGo">Book</button></div></div>
    </div>`
  $("#lClose").onclick = closeLead
  $("#askForm").onsubmit = (e) => { e.preventDefault(); const ask = $("#askText").value.trim(); if (!ask) return; busy($("#askGo"), async () => { const r = await api("/api/crm/ask", { id: l.id, ask }); const o = $("#askOut"); if (r.ok) { o.hidden = false; o.textContent = r.text } else toast(r.error || "The agent could not answer", true) }) }
  $$("#ltabs a").forEach((a) => a.onclick = () => { state.ltab = a.dataset.t; renderLead() })
  $$("#lead [data-o]").forEach((b) => b.onclick = () => outcome(b.dataset.o))
  $("#lWhenGo").onclick = async () => {
    const t = new Date($("#lWhen").value).getTime(); if (!t) return
    const r = await api("/api/crm/outcome", { id: l.id, outcome: "rdv", rdvAt: t, note: $("#lNote").value.trim() })
    after(r, "Meeting booked")
  }
}
async function outcome(o) {
  const l = state.lead; if (!l) return
  const note = $("#lNote").value.trim()
  let r
  if (o === "note") { if (!note) { $("#lMsg").textContent = "Write a note first"; return } r = await api("/api/crm/note", { id: l.id, text: note }) }
  else if (o === "next") { if (note) await api("/api/crm/note", { id: l.id, text: note }); r = await api("/api/crm/stage", { id: l.id, pipeline: l.pipeline, stage: nextStage(l) }) }
  else if (o === "meeting") { const m = $("#lMeeting"); m.hidden = !m.hidden; if (!m.hidden) { const d = new Date(Date.now() + 2 * 86400000); d.setMinutes(0, 0, 0); $("#lWhen").value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) } return }
  else if (o === "lost") r = await api("/api/crm/outcome", { id: l.id, outcome: "lost", note })
  else if (o === "won") { if (note) await api("/api/crm/note", { id: l.id, text: note }); r = await api("/api/crm/stage", { id: l.id, pipeline: "closing", stage: "signature" }) }
  after(r, { note: "Saved", next: "Moved", lost: "Marked lost", won: "Won" }[o])
}
async function after(r, okMsg) {
  if (r && r.ok) { $("#lNote").value = ""; $("#lMsg").textContent = okMsg; toast(okMsg); await loadOutreach() }
  else { $("#lMsg").textContent = (r && r.error) || "Not saved"; toast((r && r.error) || "Not saved", true) }
}

/* ───────── live ───────── */
function connect() {
  const ev = new EventSource("/events")
  ev.onopen = () => $("#live").classList.add("on")
  ev.onerror = () => $("#live").classList.remove("on")
  // events are coalesced for 250 ms, by TYPE (a burst keeps every kind, not only the last one)
  const pending = new Set(); let t = null
  const flush = () => {
    const p = new Set(pending); pending.clear(); t = null
    if (p.has("sites") || p.has("refill-done")) loadSites()
    if (p.has("batches")) { loadBatches(); loadJobs(); if (state.view === "prospects") loadProspects() }
    if (p.has("prospects") && state.view === "prospects") loadProspects()
    if ((p.has("sales") || p.has("agent")) && state.view === "outreach") loadOutreach()
    if (p.has("cage") || p.has("machine")) loadCage()
  }
  ev.onmessage = (e) => {
    let d; try { d = JSON.parse(e.data) } catch { return }
    if (d.type === "job") { onJobEvent(d); if (d.status === "done" || d.status === "error") { pending.add("batches"); pending.add("sites"); pending.add("prospects") } }
    else pending.add(d.type)
    if (!t) t = setTimeout(flush, 250)
  }
}
// while a job is live, poll too (a missed event never leaves a stale « Building »)
setInterval(() => { if ([...jobs.rows.values()].some((j) => j.status === "queued" || j.status === "running")) { loadJobs(); if (state.view === "prospects") loadProspects(); if (state.view === "sites") loadSites() } }, 5000)

/* ───────── boot ───────── */
route()
loadSites(); loadBatches(); loadCage(); loadJobs(); api("/api/agency").then((a) => { state.agency = a; setLocale(a); loadProspects() })
connect()
setInterval(loadCage, 30000)
