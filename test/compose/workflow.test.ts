/**
 * G8 + G10 : le Workflow compose-batch reçoit ses modèles par `args` (le script ne lit pas l'env), compose SANS
 * Higgsfield ni OpenAI quand les moteurs sont à `none`, n'écrit nulle part ailleurs quand `sync:false`, et le
 * beauty-gate boucle au plus GATE_MAX_LOOPS fois. Le script est exécuté par le moteur local (workflow-local.ts)
 * avec un agent ENREGISTREUR (aucun modèle), puis de bout en bout avec le faux `claude`.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { runWorkflowSource, runWorkflowFile, workflowBody, claudeAgentRunner, type AgentCall } from "../../architecture/orchestration/workflow-local.ts"
import { makeWorkspace } from "../helpers/workspace.ts"

const SCRIPT = readFileSync("architecture/orchestration/compose-batch.workflow.js", "utf8")
const ID = "orvane-piscines-valmont-sur-lys"
const PAIRS = [{ display: "Host Grotesk", display_slug: "host-grotesk", body: "Geist", body_slug: "geist" }]
const base = (extra: Record<string, unknown> = {}) => ({ date: "2026-10-24", ids: [ID], pairings: PAIRS, scores: { [ID]: 83 }, ...extra })

/** Un agent qui ne fait que noter l'appel et rendre une réponse plausible selon le libellé. */
function recorder(judge: "win" | "tie" = "win") {
  const calls: AgentCall[] = []
  const runner = async (c: AgentCall) => {
    calls.push(c)
    const l = c.opts.label ?? ""
    const value = l.startsWith("diagnose:") ? { beauty_before: { score: 3, why: "daté" }, angle: "l'eau", problems: ["tableaux"] }
      : l.startsWith("assets:") ? { boosted: [], heroVideo: false, notes: "audit" }
      : l.startsWith("compose:") ? { ok: true, path: "x", fontPair: "Host Grotesk" }
      : l.startsWith("revue:") ? { improved: false }
      : l.startsWith("judge:") ? (judge === "tie" ? { more_beautiful: "tie", margin: "tie", reasons: ["indécis"] } : { more_beautiful: /Image A : output/.test(c.prompt) ? "A" : "B", margin: "much", reasons: ["net"] })
      : "synchronisé"
    return { value, ms: 1 }
  }
  return { calls, runner, by: (prefix: string) => calls.filter((c) => (c.opts.label ?? "").startsWith(prefix)) }
}

const quiet = { log: () => {} }

test("le script Workflow se charge tel quel (export const meta) et refuse des args incomplets", async () => {
  assert.match(workflowBody(SCRIPT), /^const meta =/m)
  await assert.rejects(runWorkflowSource(SCRIPT, {}, recorder().runner, quiet), /compose-batch: fournis args/)
})

test("modèles par rôle via args.models : judge pour diagnose / auto-revue / juge, smart pour le composer", async () => {
  const r = recorder()
  const models = { smart: "claude-opus-5-5", fast: "claude-haiku-5-5", judge: "claude-sonnet-5-5" }
  const run = await runWorkflowSource(SCRIPT, base({ models, boost: false, sync: false }), r.runner, quiet)
  assert.equal(r.by("diagnose:")[0].opts.model, "claude-sonnet-5-5")
  assert.equal(r.by("compose:")[0].opts.model, "claude-opus-5-5")
  assert.equal(r.by("revue:")[0].opts.model, "claude-sonnet-5-5")
  assert.equal(r.by("judge:")[0].opts.model, "claude-sonnet-5-5")
  assert.equal(r.by("assets:")[0].opts.model, undefined, "l'asset-boost hérite du modèle de session")
  assert.deepEqual(run.result.engines.models, models)
  assert.equal(run.result.passed[0].id, ID)
  assert.equal(run.result.passed[0].verdict.margin, "much", "le verdict du juge est rendu (journalisé par first-site)")
  // sans args.models : aucun modèle forcé (la session décide), plus aucun ID figé dans le script
  const r2 = recorder()
  await runWorkflowSource(SCRIPT, base({ boost: false, sync: false }), r2.runner, quiet)
  assert.ok(r2.calls.every((c) => c.opts.model === undefined))
  assert.doesNotMatch(SCRIPT, /model: 'claude-/)
})

test("boost coupé / moteurs à none : le prompt asset n'exige NI Higgsfield NI OpenAI, pas de vidéo", async () => {
  for (const a of [{ boost: false }, { boost: true, image: "none", video: "none" }]) {
    const r = recorder()
    await runWorkflowSource(SCRIPT, base({ ...a, sync: false }), r.runner, quiet)
    const p = r.by("assets:")[0].prompt
    assert.match(p, /IMAGE : \*\*AUCUN\*\*/)
    assert.match(p, /VIDÉO : \*\*AUCUNE\*\*/)
    assert.doesNotMatch(p, /node worker\/hero-cli\.mjs/, "pas d'appel vidéo")
    assert.doesNotMatch(p, /--image data\/assets/, "pas d'édition d'image")
    assert.doesNotMatch(p, /AU MOINS UNE photo passe par Higgsfield|minimum obligatoire/i, "l'ancienne exigence Higgsfield (échec garanti sans clé) a disparu")
  }
})

test("moteurs ON : image par openai-image.mjs (jamais Higgsfield), vidéo par hero-cli pour un prospect chaud", async () => {
  const r = recorder()
  await runWorkflowSource(SCRIPT, base({ boost: true, image: "openai", video: "higgsfield", sync: false }), r.runner, quiet)
  const p = r.by("assets:")[0].prompt
  assert.match(p, /node worker\/openai-image\.mjs --prompt "\.\.\." --image data\/assets\/orvane-piscines-valmont-sur-lys\//)
  assert.match(p, /\*\*N'utilise PAS Higgsfield pour l'image\.\*\*/)
  assert.match(p, /node worker\/hero-cli\.mjs orvane-piscines-valmont-sur-lys <industrie>/)
  assert.match(p, /Minimum : le HÉROS passe au moins une fois par ce relight/)
  // vidéo coupée, image ON
  const r2 = recorder()
  await runWorkflowSource(SCRIPT, base({ boost: true, image: "openai", video: "none", sync: false }), r2.runner, quiet)
  assert.doesNotMatch(r2.by("assets:")[0].prompt, /node worker\/hero-cli\.mjs/)
})

test("sync:false : aucun agent de synchro (rien ne part vers le bucket ni la base) ; sync par défaut sinon", async () => {
  const off = recorder()
  await runWorkflowSource(SCRIPT, base({ boost: false, sync: false }), off.runner, quiet)
  assert.equal(off.by("sync:").length, 0)
  const on = recorder()
  await runWorkflowSource(SCRIPT, base({ boost: false }), on.runner, quiet)
  assert.equal(on.by("sync:").length, 1)
  assert.match(on.by("sync:")[0].prompt, /npx tsx scripts\/sync-site\.ts orvane-piscines-valmont-sur-lys 2026-10-24-composer/)
})

test("beauty-gate : au plus GATE_MAX_LOOPS (2) compositions si le juge ne départage pas, la critique est réinjectée", async () => {
  const cap = Number(/const GATE_MAX_LOOPS = (\d+)/.exec(SCRIPT)?.[1])
  assert.equal(cap, 2)
  const r = recorder("tie")
  const run = await runWorkflowSource(SCRIPT, base({ boost: false, sync: false }), r.runner, quiet)
  assert.equal(r.by("compose:").length, cap)
  assert.equal(r.by("judge:").length, cap)
  assert.match(r.by("compose:")[1].prompt, /Tentative précédente jugée PAS nettement plus belle : indécis/)
  assert.equal(run.result.passed.length, 0)
  assert.equal(run.result.failed[0].loops, cap)
})

test("juge À L'AVEUGLE : l'ordre A/B alterne d'un site à l'autre", async () => {
  const r = recorder()
  await runWorkflowSource(SCRIPT, { ...base({ boost: false, sync: false }), ids: [ID, "cuisines-lumeo-vereuil"] }, r.runner, { ...quiet, concurrency: 2 })
  const prompts = r.by("judge:").map((c) => c.prompt)
  assert.equal(prompts.filter((p) => /Image A : output\/sites/.test(p)).length, 1)
  assert.equal(prompts.filter((p) => /Image A : data\/assets/.test(p)).length, 1)
})

test("moteur local de bout en bout avec le faux claude : site écrit, gate PASS, sortie structurée native, plan sans clé API", async () => {
  const ws = makeWorkspace({ seed: ["agency"] })
  try {
    const log = ws.path("claude.log")
    const runner = claudeAgentRunner({ cwd: ws.dir, env: { ...process.env, FAKE_CLAUDE_LOG: log, ANTHROPIC_API_KEY: "sk-ant-ne-doit-pas-passer" }, log: () => {} })
    const run = await runWorkflowFile(join(ws.dir, "architecture/orchestration/compose-batch.workflow.js"), base({ boost: false, sync: false, models: { judge: "sonnet", smart: "opus" } }), runner, quiet)
    assert.equal(run.result.passed.length, 1, JSON.stringify(run.result))
    assert.ok(existsSync(join(ws.dir, "output/sites", ID, "2026-10-24-composer/index.html")))
    assert.ok(run.agents.every((a) => a.ok), JSON.stringify(run.agents))
    const calls = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l))
    assert.equal(calls.length, 5, "diagnose, assets, compose, revue, juge")
    for (const c of calls) {
      assert.equal(c.env.ANTHROPIC_API_KEY, false)
      assert.ok(c.argv.includes("--strict-mcp-config"))
      assert.ok(c.argv.includes("--json-schema"))
    }
    assert.equal(calls[0].argv[calls[0].argv.indexOf("--model") + 1], "sonnet")
  } finally { ws.cleanup() }
})
