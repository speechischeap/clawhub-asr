# ASR skill maintenance

Keep the documentation's audiences distinct: `README.md` explains the skill
and installation to people; `SKILL.md` owns runtime metadata and instructions
for agents using it; this file guides contributors. `CLAUDE.md` and
`GEMINI.md` point here.

`scripts/asr.sh` owns API-key commands and delegates explicit `--x402` commands
to `scripts/x402.mjs`. Preserve opt-in spending, signer controls, price ceilings,
and owner-only state saved before payment. Recovery reuses the original request,
proof, and file. It replays the paid request before every upload, so a failed
or expired upload reports its refund. It also polls a pending upload purchase,
because payment confirmation starts the 300-second upload window. Discard a
saved proof only when the service declines it with a fresh `PAYMENT-REQUIRED`
or a 402 `PAYMENT-RESPONSE` whose `success` is false. Both mean it took no
payment and will never settle that proof. Keep the proof after any uncertain
reply. Keep payment state outside the repository.
Follow the response contract in the [x402 API docs](https://docs.speechischeap.com/x402-v2/).

Use Node.js 22 or newer and pnpm. For helper or packaging changes, run
`pnpm install --frozen-lockfile`, `pnpm test`,
`bash -n scripts/asr.sh publish.sh`, and `git diff --check`. Tests use mocked
HTTP and an unfunded signer. Documentation-only changes need link and
frontmatter checks instead of runtime tests.

Use `gh` for this public GitHub repository. Follow HubFlow: start features
with `git hf feature start <name>` from `develop`; feature PRs target
`develop`, and release PRs target `master`. Keep feature PRs to one
Conventional Commit and use the `generate-commit` skill.

ClawHub reads metadata from `SKILL.md` frontmatter. `manifest.json` still
supplies the version to `publish.sh`; it does not declare runtime requirements.
Update that version and date the changelog through the release workflow.
`publish.sh` packages runtime files and then publishes after its confirmation.
It needs `clawhub` CLI 0.23 or newer, logged in to `https://clawhub.ai`;
older CLIs cannot accept ClawHub's license terms. Update its file list when
adding runtime files. ClawHub publishes every skill under MIT-0, so `LICENSE`
and `manifest.json` say MIT-0 and keep the copyright notice; add no other
license terms to `SKILL.md`. Publication, live payments, and merges require
an explicit request.

The `speechischeap` org publisher owns the listing at
`https://clawhub.ai/speechischeap/skills/asr`. Publish through `publish.sh`,
which passes `--owner speechischeap`; an upload without an owner becomes a
separate personal skill and makes the bare `asr` slug ambiguous. ClawHub holds
back an upload whose security checks fail. Read its stored results with
`clawhub scan download asr --version <version>`. To separate a ClawHub outage
from a content problem, rescan a version that passed before with
`clawhub scan --slug asr --version <version>`, leaving out `--update`, which
writes results back. Raise a held upload with the user before contacting
ClawHub support.
