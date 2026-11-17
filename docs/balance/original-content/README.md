# Content before B6 balancing

A copy of `content/*.json` as it was on `main` before the B6 balance changes
(2026-11-17, commit `db67d2f`). Kept so the original values can be restored or
compared at any time:

- Simulate with them: `pnpm sim --content docs/balance/original-content ...`
- Restore one file: `cp docs/balance/original-content/rules.json content/`
- Or revert the single commit that made a change (each B6 content change is its own commit; see `docs/balance/b6-report.md`).

The game never reads this folder.
