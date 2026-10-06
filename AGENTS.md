# ASR skill maintenance

Keep the documentation's audiences distinct: `README.md` explains the skill
and installation to people; `SKILL.md` owns runtime metadata and instructions
for agents using it; this file guides contributors. `CLAUDE.md` and
`GEMINI.md` point here.

`scripts/asr.sh` owns API-key commands and delegates explicit `--x402` commands
to `scripts/x402.mjs`. Preserve opt-in spending, signer controls, price ceilings,
and owner-only state saved before payment. Recovery reuses the original request,
proof, and file. Keep payment state outside the repository.

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
`publish.sh` packages runtime files and then publishes after its confirmation;
update its file list when adding runtime files. Publication, live payments,
and merges require an explicit request. Public x402 enablement remains a
separate release requirement; mocked tests do not prove live readiness.
