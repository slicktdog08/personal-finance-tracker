@AGENTS.md

## Personal data

This repo is public, but the app holds its owner's real finances. **Never put real names,
amounts, balances, account numbers, merchants, locations or employer details into tracked
files** — code, tests, comments, commit messages and docs all use illustrative values
(`$2,000 on the 15th`, `Card A`, `ACME CORP PAYROLL`, `ANYTOWN, CA`).

Real data belongs only in git-ignored places:

- `.env*` — credentials (`.env.example` / `.env.test.example` are the committed templates)
- `config/advisor-profile.json` — the MCP advisor's profile of the user
- `planning/progress/`, `planning/projects/` — dev logs and side projects written against live data
- `private/`, `notion_data/`, `temp/`, `.setting/` — statements, exports, scratch, query logs

When you'd normally write a dev log with live verification numbers, put it in
`planning/progress/` (ignored); keep `planning/features/` and `planning/design/` generic.
`scripts/check-private.sh` runs as a pre-commit hook and blocks staged secrets plus any line
matching the owner's own `.private-patterns`; don't bypass it with `--no-verify` without asking.

New users: run the `/setup` skill.
