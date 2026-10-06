# Kick contract for fran-hrm

This file says what a kicked session owes the outer loop (Grok Bot) when it finishes. It is a draft. Amend it by PR.

## Scope classes

Classes follow `agent-home/operating-model.md`.

| Class | Meaning | Who acts |
|---|---|---|
| A | Code, docs, tests, and migrations written in this repo, delivered as a draft PR | The kicked session |
| B | Production reads: health checks, `db:migrate:status`, dry runs | Outer loop |
| C | Merge a green PR into `main`, `vercel --prod` | Outer loop, allowlist only |
| D | Apply migrations to the production database, remint live PINs or API keys, anything touching money, customers, or secrets | Outer loop runs the dry run, then waits for JT's yes in his own words |

A kicked session does class A and stages the rest with the exact command. It never merges, deploys, applies a migration to production, remints live data, or force-pushes.

## Worktree rules

A session works only in the worktree it was kicked into. It does not create another worktree. It does not touch the owner's main checkout at `C:\Users\Jeremy Tan\CodeProjects\fran-hrm`.

The session pushes only the branch it was kicked on. That branch is created from `main`.

## What the session returns

Report these items, verdict first, in plain bullets.

- The draft PR URL, as `https://github.com/wytanj/fran-hrm/pull/<number>`. When `gh` is not authenticated, push the branch and return the compare URL (`https://github.com/wytanj/fran-hrm/compare/main...<branch>?expand=1`) so JT can open the draft.
- Files touched, as a list of paths with one clause each on what changed.
- Verify notes. Name the surface each check ran on and what it proved.
- The `npm test` result against the baseline. State pre-existing failures separately from new ones.
- What was staged rather than done, and its class.
- Anything that blocked, and what unblocks it.

## Briefs

A kick may carry a brief under `agent-home/briefs/`. When the PR finishes that item, the same PR deletes the brief. A PR that only advances the item leaves the brief in place.

## Migrations

Migrations live in `core/db/` and apply through `npm run db:migrate`. A session writes the migration and proves it locally when it can. Applying it to the shared database is class D. The session stages `npm run db:migrate:status` (class B) and then `npm run db:migrate` (class D). Checksummed files are never edited after they apply. Add a new file.

## Done webhook

When `%USERPROFILE%\.config\agent-loop\done-webhook.env` is present, the session sends a POST to `DONE_WEBHOOK_URL` on finish with `Authorization: Bearer $DONE_WEBHOOK_KEY` and `X-Automation-Key: $DONE_WEBHOOK_KEY`.

```json
{
  "event": "session_done",
  "repo": "fran-hrm",
  "slug": "<short-slug>",
  "session": "claude-<short-slug>",
  "status": "ok",
  "summary": "one or two sentences",
  "pr_url": "https://github.com/wytanj/fran-hrm/pull/<number>",
  "class_c_ready": false
}
```

Set `class_c_ready` to `true` only when a merge or deploy is ready to run with no class D step in front of it. The key never appears in chat or in a commit.

When the env file is absent, the session says so in its reply and sends nothing.
