<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Commits After Fixes

- After completing fixes and running the relevant checks, create a Git commit without waiting for a separate request.
- Before committing, inspect `git status`, `git diff`, and recent commits. Stage only changes belonging to the current task; do not include unrelated work or secrets.
- Use a concise commit message describing the fix. Report the commit hash and check results, including any checks that could not be run.
- Do not amend commits or push unless explicitly requested.
