# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

Agentic session manager that **monitors repositories and their evolution and status**. The first feature is a page to select a repository to monitor.

## Commands

```bash
npm run dev        # run API (tsx watch) + Vite web dev server together via concurrently
npm run dev:api    # API only, on API_PORT (default 3001)
npm run dev:web    # Vite web only, on port 5173 (proxies /api -> API_PORT)
npm run build      # tsc -b (typecheck via project refs) then vite build
npm run typecheck  # tsc -b --noEmit
npm start          # run the API without watch
```

There is no test runner wired up yet.

## Architecture

Two processes, split by tsconfig project references (`tsconfig.app.json` for the browser, `tsconfig.node.json` for the server):

- **Web** — Vite + React + TS in `src/`. `App.tsx` fetches `GET /api/repos` via `src/api.ts`, filters/selects repos, and renders `components/RepoCard.tsx`. Vite (`vite.config.ts`) proxies `/api` to the API server.
- **API** — Express in `server/index.ts`. Reads the repo list from a **manual config file** (`repos.config.json`, override with `REPOS_CONFIG`), then enriches each entry with live git status by shelling out to `git` (`branch`, `status --porcelain` dirty count, last commit, `worktree list`). Every git call is wrapped so a missing path or non-repo degrades to `available: false` instead of throwing. Endpoints: `GET /api/repos` (list + `selectedId`), `GET /api/repos/:id/status` (changed files, ahead/behind), `GET /api/repos/:id/log?limit=` (recent commits, structured), `GET /api/repos/:id/worktrees` (main + linked worktrees, parsed from `git worktree list --porcelain`; first entry is the main tree), `POST /api/repos/:id/merge-worktree` (merge a linked worktree's branch into the main working tree via `git merge --no-edit` run in the main tree; refuses if the target is dirty, aborts on conflict so main is never left half-merged; validated against the repo's worktrees), `POST /api/repos/:id/commit` (stage all + commit with an **AI-generated message**: the server sends the diff to Claude via the Anthropic SDK — model `claude-opus-4-8` — and commits with the result; computes the diff *without* touching the index, so a generation failure leaves the tree unstaged; honors `?worktree` via body), `POST /api/repos/:id/push` (push the **main** working tree's branch to `origin` via `git push origin <branch>`; validates a main tree + `origin` remote exist; refuses if detached; UI shows the Push button only on the main tree, gated behind a confirm), `GET /api/repos/:id/graph?style=plain|pretty|forest&all=&decorate=&oneline=&graph=&limit=` (git-log graph; `plain` = raw flags, `pretty` = fixed colored `--format` with `--color=always`, `forest` = shells out to `git-foresta`/`git-forest` if on PATH else `forestAvailable:false`; all flags allowlisted — no user strings reach git; ANSI output rendered client-side by `AnsiText.tsx`), `GET /api/browse?path=` (filesystem picker), `POST /api/repos` (add a local repo, which also becomes selected), `PUT /api/selection` (persist `{ id: string | null }`), `PUT /api/selection/worktree` (persist the active worktree `{ path: string | null }`; validated against the selected repo's worktrees), and the **release pipeline** endpoints (see below).

**Release pipeline (tests → commit → merge → bump → push):** `GET /api/repos/:id/test-runners` detects how to run the repo's tests, ranked (`docker-script` for `scripts/docker-test.sh` etc.; `npm` for `test`/`test:ci`/`test:unit`/`test:e2e`; `other` for go/cargo/pytest/Makefile). `POST /api/repos/:id/pipeline` `{ command, push, worktree }` starts a **streamed job** (in-memory `jobs` Map, `crypto.randomUUID` id). **The steps deliberately split between the selected worktree and main** (`runPipeline`): (1) **tests** — `spawn("bash", ["-c", command], {detached})` in the **selected worktree**, streaming stdout/stderr, **fail-fast** on non-zero exit; (2) **commit** — AI commit (`generateCommitMessage` + `git add -A`/`commit`) **in the worktree** (skipped if clean; captures the diff for the bump); (3) **merge** — `git merge --no-edit <worktreeBranch>` into **main** (skipped when already on main; refuses if main is dirty; aborts on conflict); (4) **bump** — in **main**: `decideBump` sends the captured diff to Claude (`claude-opus-4-8`) → major/minor/patch, applied to main's `package.json`, committed as `chore: bump version to X`; (5) **push** — `git push origin <mainBranch>` from **main** (skippable). Bump/merge/push never run in the worktree. `GET …/pipeline/:jobId/stream` is **SSE** (`text/event-stream`): replays buffered `PipelineEvent`s then streams live `step`/`log`/`done`. `POST …/pipeline/:jobId/cancel` kills the process group. UI: a **Release tab** (`components/ReleaseTab.tsx`, threaded `selectedWorktree`) with a runner select + editable command, push checkbox, a confirm, live console (`AnsiText`), per-step chips (Tests/Commit/Merge/Bump/Push), and Stop (consumes the stream via the browser `EventSource`).

⚠️ **Security (this API is unauthenticated and powerful — RCE via the pipeline, filesystem read via `/browse`, git push, billable Claude calls):**
- The server **binds to `127.0.0.1` by default** (`HOST = process.env.API_HOST ?? "127.0.0.1"`) so it is not LAN-reachable. Overriding `API_HOST` without adding your own auth re-opens unauthenticated RCE — don't.
- The Vite proxy targets **`http://127.0.0.1:...`** (not `localhost`) to match the IPv4 loopback bind.
- The pipeline's test step runs the repo's own command (arbitrary code). Its child env is sanitized by `childEnv()` — `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` are **stripped** so a test script can't exfiltrate the key loaded from `.env`. The command is always detected + shown + confirmed, never inferred-and-run silently.

**Active worktree:** config also holds `selectedWorktree` (a path; null = main tree). The status/log/graph endpoints accept `?worktree=<path>` and run git in that directory *only if* it's a real worktree of the repo — `resolveWorktreePath` validates against `git worktree list` and otherwise falls back to the repo's main path (never runs git in an arbitrary dir). Switching repos (`PUT /api/selection`) resets the active worktree to main. The frontend threads `selectedWorktree` into status/graph fetches so Changes/History reflect the chosen worktree; clicking a row in the Worktrees tab sets it.

Config writes go through `saveConfig`, which writes a temp file then `rename`s it — an **atomic write** so concurrent readers (e.g. a status request firing alongside a selection write) never observe a truncated file.
- **Shared** — `shared/types.ts` holds the `RepoConfigEntry` / `RepoStatus` / `Repo` contract, imported by both sides (with `.ts` extensions, resolved by the bundler / tsx).

Data flow: `repos.config.json` → `loadConfig()` → per-repo `readStatus()` (git shell-outs) → `GET /api/repos` → React UI.

## Conventions & gotchas

- **Do not read `process.env.PORT` in the API** — the preview/launch harness injects `PORT=5173` (Vite's port). The API uses `API_PORT` specifically to avoid colliding with the web server.
- To add a monitored repo, append an entry to `repos.config.json` (`id`, `name`, and optional `path`/`description`/`url`); no code change needed. A repo without a local `path` shows as unavailable (no git status).
- `repos.config.json` also holds a top-level `selectedId` — the persisted "active repo". The API clears it on read if it points at a repo that no longer exists.
- TS is configured with `allowImportingTsExtensions`, so intra-project imports include the `.ts`/`.tsx` extension.
- `npm install` may leave esbuild's postinstall unapproved (allow-scripts guard); Vite needs it. Approved via the `allowScripts` block in `package.json`.
- The AI commit-message feature (`POST /api/repos/:id/commit`) uses the `@anthropic-ai/sdk` from the **API server process** — it needs `ANTHROPIC_API_KEY` (or an `ANTHROPIC_AUTH_TOKEN` / `ant auth login` profile) in that process's environment. Without it the endpoint returns a friendly 401 and never stages/commits. `new Anthropic()` is constructed lazily inside the handler so the server still boots without credentials.
