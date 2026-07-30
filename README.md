# agentic_session_manager

A local web app to **monitor a repository and its git worktrees** — their status, history, divergence, and release flow — from one dashboard. TypeScript / Node.js.

> ⚠️ The API is **unauthenticated and powerful** (runs git, shells out arbitrary commands, pushes, makes billable Claude calls). It **binds to `127.0.0.1` only** by design. Do not expose it.

## What it does

Pick a local repo (it also reads its linked worktrees) and work across these tabs:

- **Changes** — working-tree diff per file; commit with an AI-generated message (Claude) or your own; stage-and-commit.
- **History** — a **List** view (rich commit rows → click for a per-file diff inspector, checkout) and a **Graph** view rendering `git log --graph` (`pretty`, always available) or **git-foresta** (`forest`, if installed; otherwise it falls back to pretty). Wired Style / `--all` / limit controls.
- **Worktrees** — create / merge → main / sync ← main; click one to make it the active working tree.
- **Compare** — divergence matrix of every branch + worktree vs a base (default `main`): ahead / behind / merge-base / dirty, expandable to each branch's unique commits, with **copy git-name** and **Prune** (remove a merged worktree / delete a merged branch) actions.
- **Release** — a streamed pipeline: **tests → commit → merge → bump → push → deploy** (tests run in the selected worktree; commit/merge/bump/push/deploy land on main). Bump version is chosen by Claude; push and deploy are opt-in.
- **Terminal** — run a shell command in the active repo/worktree.
- **Settings** — developer profile + live API-server health.

## Architecture

Two processes, split by tsconfig project references:

- **Web** — Vite + React + TS + Tailwind in `src/`. `App.tsx` is the container that fetches from `src/api.ts` and passes props to presentational components; API types (`shared/types.ts`) map to view-models (`src/types.ts`) via `src/adapters.ts`.
- **API** — Express in `server/index.ts`. Reads the repo list from `repos.config.json` and enriches each entry with live git status by shelling out to `git`.

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

Monitored repos live in `repos.config.json` (override the path with `REPOS_CONFIG`). Add an entry with `id`, `name`, and an optional `path` — no code change needed. The file also persists the active repo (`selectedId`) and active worktree.
