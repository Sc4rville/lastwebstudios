/**
 * npm run preview — serves what the pipeline produced (distribution/packages/) and prints the links.
 */
import { readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { serveStatic } from "../demo/server.ts"

const root = join("distribution", "packages")
if (!existsSync(root)) {
  console.error("Nothing to preview yet — run `npm run demo` first.")
  process.exit(1)
}
const port = Number(process.env.PORT) || 4173
const { url } = await serveStatic(root, port)
console.log(`\nServing ${root} on ${url}\n`)
for (const id of await readdir(root)) {
  console.log(`  ${id}`)
  console.log(`    before / after   ${url}/${id}/`)
  console.log(`    the demo         ${url}/${id}/site/`)
}
console.log("\nCtrl+C to stop.")
