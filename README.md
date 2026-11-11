# agentic_session_manager

A local web app to **monitor your repositories and their git worktrees** — their status, history, divergence, and release flow — from one dashboard. Works as a fleet view over a hundred-plus repos, or as a deep per-repo tool. TypeScript / Node.js.

> ⚠️ The API is **unauthenticated and powerful** (runs git, shells out arbitrary commands, pushes, makes billable Claude calls). It **binds to `127.0.0.1` only** by design. Do not expose it.

## What it does

Start on the **Overview** — every configured repo in one table — then pick one (it also reads its linked worktrees) and work across these tabs:

- **Overview** — the fleet dashboard: all configured repos in one sortable table with branch, uncommitted-file count, last-commit subject + age, and worktree count, plus a summary strip (how many are dirty, stale, unavailable). Filter by name, branch, path or purpose; sort by any column — it defaults to **stalest first**, since the point is finding what you forgot. Clicking a row selects that repo and drops into the tabs below. It's the landing view when no repo is selected.
- **Changes** — working-tree diff per file; commit with an AI-generated message (Claude) or your own; stage-and-commit.
- **History** — a **List** view (rich commit rows → click for a per-file diff inspector, checkout) and a **Graph** view rendering `git log --graph` (`pretty`, always available) or **git-foresta** (`forest`, if installed; otherwise it falls back to pretty). Wired Style / `--all` / limit controls.
- **Worktrees** — create / merge → main / sync ← main; click one to make it the active working tree.
- **Compare** — divergence matrix of every branch + worktree vs a base (default `main`): ahead / behind / merge-base / dirty, expandable to each branch's unique commits. Per-row actions: **Merge** a branch that's ahead into the base (works even when the base isn't checked out — it merges in a throwaway worktree, leaving your tree untouched), **Prune** a merged worktree / delete a merged branch, **⇥ base + Delete** to retire the merged branch you're currently on, and **copy** the git name.
- **Release** — a streamed pipeline: **tests → commit → merge → bump → push → deploy** (tests run in the selected worktree; commit/merge/bump/push/deploy land on main). Bump version is chosen by Claude; push and deploy are opt-in.
- **Terminal** — run a shell command in the active repo/worktree.
- **Settings** — developer profile + live API-server health.

## Architecture

Two processes, split by tsconfig project references:

- **Web** — Vite + React + TS + Tailwind in `src/`. `App.tsx` is the container that fetches from `src/api.ts` and passes props to presentational components; API types (`shared/types.ts`) map to view-models (`src/types.ts`) via `src/adapters.ts`.
- **API** — Express in `server/index.ts`. Reads the repo list from `repos.config.json` and enriches each entry with live git status by shelling out to `git`.

`GET /api/repos` enriches every configured repo, so its cost is dominated by **process spawns, not by git's own work**: at 105 repos each additional `git` invocation per repo costs roughly 250ms of wall clock, whether the calls are made in series or concurrently. `readStatus` is therefore kept to **two** spawns — `status --porcelain=v1 -b` (branch *and* dirty count in one) and `log -1` — with worktree paths read straight off `.git/worktrees/` instead of a third `git worktree list`. Measured on 105 local repos: **~0.75s warm, ~0.81s cold**, down from ~1.75s with the original four-spawn version. There is no cache; the numbers didn't call for one.

See [CLAUDE.md](CLAUDE.md) for the full endpoint/architecture reference.

## Commands

```bash
npm run dev        # API (tsx watch) + Vite web dev server together
npm run dev:api    # API only, on API_PORT (default 3001)
npm run dev:web    # Vite web only (proxies /api → API_PORT)
npm run build      # tsc -b (typecheck) then vite build
npm run typecheck  # tsc -b --noEmit
npm start          # run the API without watch
```

The web dev server runs on `5173` and proxies `/api` to the API on `API_PORT` (default `3001`). The AI features (commit message, version bump) need `ANTHROPIC_API_KEY` (or `ant auth login`) in the API process's environment.

## Configuration

Monitored repos live in `repos.config.json` (override the path with `REPOS_CONFIG`). Add an entry with `id`, `name`, and an optional `path`/`description` — no code change needed. The file also persists the active repo (`selectedId`) and active worktree.

The repo switcher in the sidebar has its own filter box (name / branch / path) and a **Browse all in Overview** link, so the list stays usable well past a hundred entries.

In-app, click **+ Add local repo** and either paste the absolute path or use **Browse…** — a folder-picker dialog that walks the filesystem and flags which folders are git repos.
