# Philosophy

The working method of the project. It is a document, not a skill, and it applies to every session.

## Build and tool up at the same time

Building means two actions, not one:

1. deliver what was asked;
2. turn into a **reusable skill or script** whatever has just been done by hand more than twice, and leave the
   repository and its docs in the state the next person needs.

A task that is redone by hand is a tool that has not been written yet. Every captured skill removes a future
repetitive task; the machine and the method that builds it progress together. That is "the loop".

## Prove it on several real cases

**"The code runs" is not "the system works."** For every stage built or changed, the exit code is not enough: run
the real flow on **several diverse prospects** (three to five), look at the output (sheets, sites, mails, briefs),
judge it honestly, iterate. A stage that compiles but produces poor results on real cases is useless. The proof is
the result on several cases; the examples in `examples/` and the fictional cast in `data/sample/` exist for that.

## A bug comes with its test

Every fix in this repository was made the same way: write the test, watch it fail on the old code, fix, watch it
pass. The suite runs offline in a throwaway workspace with a fake `claude`, so there is no excuse not to run it.
Adversarial tests (pipes cut into tiny chunks, two ticks at once, hostile bodies on every route, hostile web
servers) found more real bugs than reading did.

## Honest by construction

The product writes to strangers and spends money. The method is therefore conservative where it matters: nothing
sends without two human switches, nothing real ships in the repository, the machine says what it would have done
(dry-run, `.eml` files, estimates) before it is allowed to do it, and every number in a document comes from a run
or from the code.

## At the end of a task

Ask: *what did I just redo that could become a skill or a script?* If something, create it. Then: are the docs
still true (`docs/CONFIGURATION.md` for a variable, the folder's README for a command), is the repository clean,
does `node scripts/oss/scan.mjs .` still report nothing real.
