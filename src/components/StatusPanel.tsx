import { useCallback, useEffect, useState } from "react";
import type { FileChange, GitStatusDetail, Worktree } from "../../shared/types.ts";
import {
  commitChanges,
  fetchGraph,
  fetchStatus,
  fetchWorktrees,
  mergeWorktree,
  pushToOrigin,
  syncWorktreeFromMain,
  type GraphOptions,
  type GraphResult,
  type GraphStyle,
} from "../api.ts";
import { AnsiText } from "./AnsiText.tsx";
import { ReleaseTab } from "./ReleaseTab.tsx";

const CODE_LABEL: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
  U: "Conflict",
};

interface FileInfo {
  badge: string;
  cls: string;
  label: string;
}

function describe(f: FileChange): FileInfo {
  if (f.x === "?") return { badge: "?", cls: "fc--untracked", label: "Untracked" };
  if (f.x === "U" || f.y === "U") return { badge: "U", cls: "fc--conflict", label: "Conflict" };

  const staged = f.x !== " ";
  const unstaged = f.y !== " ";
  const primary = staged ? f.x : f.y;
  const where = staged && unstaged ? "staged + unstaged" : staged ? "staged" : "unstaged";
  const cls =
    primary === "A"
      ? "fc--added"
      : primary === "D"
        ? "fc--deleted"
        : primary === "R" || primary === "C"
          ? "fc--renamed"
          : "fc--modified";

  return { badge: primary, cls, label: `${CODE_LABEL[primary] ?? primary} · ${where}` };
}

type Tab = "changes" | "history" | "worktrees" | "release";

interface StatusPanelProps {
  repoId: string;
  reloadKey: number;
  selectedWorktree: string | null;
  onSelectWorktree: (path: string | null) => void;
  onRefresh: () => void;
}

export function StatusPanel({
  repoId,
  reloadKey,
  selectedWorktree,
  onSelectWorktree,
  onRefresh,
}: StatusPanelProps) {
  const [tab, setTab] = useState<Tab>("changes");

  const [status, setStatus] = useState<GitStatusDetail | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [merging, setMerging] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  async function mergeToMain() {
    if (!selectedWorktree) return;
    const branch = status?.branch ?? "this worktree";
    if (
      !window.confirm(
        `Merge branch "${branch}" into the main working tree?\n\nThis runs \`git merge ${branch}\` in the repo's main worktree.`,
      )
    ) {
      return;
    }
    setMerging(true);
    setNotice(null);
    try {
      const r = await mergeWorktree(repoId, selectedWorktree);
      setNotice({
        ok: true,
        text: r.alreadyUpToDate
          ? `'${r.target}' is already up to date with '${r.source}'.`
          : `Merged '${r.source}' into '${r.target}'.`,
      });
      onRefresh();
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setMerging(false);
    }
  }

  async function syncFromMain() {
    if (!selectedWorktree) return;
    const branch = status?.branch ?? "this worktree";
    if (
      !window.confirm(
        `Sync branch "${branch}" with main?\n\nThis runs \`git merge main\` inside this worktree, bringing main's commits into "${branch}".`,
      )
    ) {
      return;
    }
    setSyncing(true);
    setNotice(null);
    try {
      const r = await syncWorktreeFromMain(repoId, selectedWorktree);
      setNotice({
        ok: true,
        text: r.alreadyUpToDate
          ? `'${r.target}' is already up to date with '${r.source}'.`
          : `Synced '${r.target}' with '${r.source}'.`,
      });
      onRefresh();
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setSyncing(false);
    }
  }

  async function stageAndCommit() {
    const count = status?.files.length ?? 0;
    if (
      !window.confirm(
        `Stage all changes and commit ${count} file${count === 1 ? "" : "s"} with an AI-generated message?\n\nThe message is written by Claude (Anthropic SDK) from the diff.`,
      )
    ) {
      return;
    }
    setCommitting(true);
    setNotice(null);
    try {
      const r = await commitChanges(repoId, selectedWorktree);
      setNotice({ ok: true, text: `Committed ${r.hash}: ${r.subject}` });
      onRefresh();
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setCommitting(false);
    }
  }

  async function push() {
    const branch = status?.branch ?? "the current branch";
    const ahead = status?.ahead ?? 0;
    if (
      !window.confirm(
        `Push ${ahead > 0 ? `${ahead} commit${ahead === 1 ? "" : "s"} on ` : ""}"${branch}" to origin?\n\nThis runs \`git push origin ${branch}\` and updates the remote.`,
      )
    ) {
      return;
    }
    setPushing(true);
    setNotice(null);
    try {
      const r = await pushToOrigin(repoId);
      setNotice({ ok: true, text: `Pushed '${r.branch}' to ${r.remote}.` });
      onRefresh();
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setPushing(false);
    }
  }

  const hasChanges = Boolean(status?.available && !status.clean);
  // "In the main repo" = the main working tree is active (no linked worktree selected).
  const onMainTree = selectedWorktree === null;

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      setStatus(await fetchStatus(repoId, selectedWorktree));
    } catch (err) {
      setStatusError((err as Error).message);
    } finally {
      setStatusLoading(false);
    }
  }, [repoId, selectedWorktree]);

  // Status (branch/ahead/behind chips + Changes tab) — always kept fresh.
  useEffect(() => {
    void loadStatus();
  }, [loadStatus, reloadKey]);

  const worktreeName = selectedWorktree ? selectedWorktree.split("/").pop() : null;

  return (
    <section className="status">
      <header className="status__header">
        <div className="status__ident">
          <h2 className="status__name">{status?.name ?? "…"}</h2>
          {worktreeName && (
            <span className="chip chip--wt" title={selectedWorktree ?? undefined}>
              ⑂ {worktreeName}
            </span>
          )}
          {status?.branch && <span className="chip">{status.branch}</span>}
          {status && status.ahead > 0 && <span className="chip chip--muted">↑{status.ahead}</span>}
          {status && status.behind > 0 && <span className="chip chip--muted">↓{status.behind}</span>}
        </div>
        <div className="status__actions">
          {tab === "changes" && hasChanges && (
            <button
              className="btn btn--sm btn--primary"
              onClick={() => void stageAndCommit()}
              disabled={committing || statusLoading}
              title="Stage all changes and commit with a Claude-generated message"
            >
              {committing ? "Committing…" : "Commit (AI)"}
            </button>
          )}
          {selectedWorktree && (
            <button
              className="btn btn--sm"
              onClick={() => void syncFromMain()}
              disabled={syncing || merging || statusLoading}
              title="Merge the main branch into this worktree's branch (git merge main)"
            >
              {syncing ? "Syncing…" : "Sync ← main"}
            </button>
          )}
          {selectedWorktree && (
            <button
              className="btn btn--sm btn--primary"
              onClick={() => void mergeToMain()}
              disabled={merging || syncing || statusLoading}
              title="Merge this worktree's branch into the main working tree"
            >
              {merging ? "Merging…" : "Merge → main"}
            </button>
          )}
          {onMainTree && status?.available && (
            <button
              className="btn btn--sm btn--primary"
              onClick={() => void push()}
              disabled={pushing || statusLoading}
              title="Push commits on the main branch to origin"
            >
              {pushing ? "Pushing…" : status.ahead > 0 ? `Push ↑${status.ahead}` : "Push"}
            </button>
          )}
          <button className="btn btn--sm" onClick={() => void loadStatus()} disabled={statusLoading}>
            {statusLoading ? "…" : "Refresh"}
          </button>
        </div>
      </header>

      {notice && (
        <div className={`banner ${notice.ok ? "banner--ok" : "banner--error"}`}>{notice.text}</div>
      )}

      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "changes"}
          className={`tab${tab === "changes" ? " tab--active" : ""}`}
          onClick={() => setTab("changes")}
        >
          Changes
        </button>
        <button
          role="tab"
          aria-selected={tab === "history"}
          className={`tab${tab === "history" ? " tab--active" : ""}`}
          onClick={() => setTab("history")}
        >
          History
        </button>
        <button
          role="tab"
          aria-selected={tab === "worktrees"}
          className={`tab${tab === "worktrees" ? " tab--active" : ""}`}
          onClick={() => setTab("worktrees")}
        >
          Worktrees
        </button>
        <button
          role="tab"
          aria-selected={tab === "release"}
          className={`tab${tab === "release" ? " tab--active" : ""}`}
          onClick={() => setTab("release")}
        >
          Release
        </button>
      </div>

      {tab === "changes" ? (
        <ChangesTab status={status} loading={statusLoading} error={statusError} />
      ) : tab === "history" ? (
        <HistoryTab repoId={repoId} reloadKey={reloadKey} worktree={selectedWorktree} />
      ) : tab === "worktrees" ? (
        <WorktreesTab
          repoId={repoId}
          reloadKey={reloadKey}
          selectedWorktree={selectedWorktree}
          onSelectWorktree={onSelectWorktree}
        />
      ) : (
        <ReleaseTab
          repoId={repoId}
          reloadKey={reloadKey}
          worktree={selectedWorktree}
          onRefresh={onRefresh}
        />
      )}
    </section>
  );
}

function ChangesTab({
  status,
  loading,
  error,
}: {
  status: GitStatusDetail | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) return <div className="banner banner--error">{error}</div>;
  if (loading && !status) return <p className="muted status__msg">Loading git status…</p>;
  if (status && !status.available)
    return <p className="muted status__msg">Repository unavailable — path missing or not a git repo.</p>;
  if (status && status.clean) return <p className="status__clean">✓ Working tree clean</p>;
  if (!status) return null;

  return (
    <>
      <p className="muted status__count">
        {status.files.length} changed file{status.files.length === 1 ? "" : "s"}
      </p>
      <ul className="status__files">
        {status.files.map((f) => {
          const info = describe(f);
          return (
            <li key={f.path} className="status__file" title={info.label}>
              <span className={`fc ${info.cls}`}>{info.badge}</span>
              <span className="status__filepath">{f.path}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// Flags that only apply to the "plain" style (pretty/forest control these themselves).
const PLAIN_FLAGS: { key: "decorate" | "oneline" | "graph"; label: string }[] = [
  { key: "decorate", label: "--decorate" },
  { key: "oneline", label: "--oneline" },
  { key: "graph", label: "--graph" },
];

const STYLES: { value: GraphStyle; label: string }[] = [
  { value: "plain", label: "Plain" },
  { value: "pretty", label: "Pretty (colored)" },
  { value: "forest", label: "Forest (git-foresta)" },
];

const DEFAULT_GRAPH_OPTS: GraphOptions = {
  style: "pretty",
  all: true,
  decorate: true,
  oneline: true,
  graph: true,
  limit: 200,
};

// Mirrors PRETTY_FORMAT on the server — for an accurate live command preview.
const PRETTY_FORMAT =
  "%C(bold blue)%h%C(reset) %C(green)(%ar)%C(reset)%C(auto)%d%C(reset) %s %C(dim white)- %an%C(reset)";

function previewCommand(o: GraphOptions): string {
  if (o.style === "forest") {
    return ["git-foresta", o.all && "--all", `-${o.limit}`].filter(Boolean).join(" ");
  }
  if (o.style === "pretty") {
    return [
      "git log --graph --color=always",
      o.all && "--all",
      `-n${o.limit}`,
      `--format='${PRETTY_FORMAT}'`,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    "git log",
    o.all && "--all",
    o.decorate && "--decorate",
    o.oneline && "--oneline",
    o.graph && "--graph",
    `-n${o.limit}`,
  ]
    .filter(Boolean)
    .join(" ");
}

function HistoryTab({
  repoId,
  reloadKey,
  worktree,
}: {
  repoId: string;
  reloadKey: number;
  worktree: string | null;
}) {
  const [opts, setOpts] = useState<GraphOptions>(DEFAULT_GRAPH_OPTS);
  const [result, setResult] = useState<GraphResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (o: GraphOptions) => {
      setLoading(true);
      setError(null);
      try {
        setResult(await fetchGraph(repoId, o, worktree));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [repoId, worktree],
  );

  // Run with the current options when the repo changes or a global refresh fires.
  // Toggling a checkbox does NOT auto-run — the user hits "Run".
  useEffect(() => {
    void run(opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, reloadKey]);

  return (
    <div className="graph-tab">
      <form
        className="graph-setup"
        onSubmit={(e) => {
          e.preventDefault();
          void run(opts);
        }}
      >
        <div className="graph-setup__flags">
          <label className="graph-setup__style">
            <span className="muted">style</span>
            <select
              value={opts.style}
              onChange={(e) => setOpts((o) => ({ ...o, style: e.target.value as GraphStyle }))}
            >
              {STYLES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="graph-setup__flag">
            <input
              type="checkbox"
              checked={opts.all}
              onChange={(e) => setOpts((o) => ({ ...o, all: e.target.checked }))}
            />
            <code>--all</code>
          </label>

          {opts.style === "plain" &&
            PLAIN_FLAGS.map(({ key, label }) => (
              <label key={key} className="graph-setup__flag">
                <input
                  type="checkbox"
                  checked={opts[key]}
                  onChange={(e) => setOpts((o) => ({ ...o, [key]: e.target.checked }))}
                />
                <code>{label}</code>
              </label>
            ))}

          <label className="graph-setup__limit">
            <span className="muted">limit</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={opts.limit}
              onChange={(e) => setOpts((o) => ({ ...o, limit: Number(e.target.value) || 1 }))}
            />
          </label>
          <button type="submit" className="btn btn--primary btn--sm" disabled={loading}>
            {loading ? "Running…" : "Run"}
          </button>
        </div>
        <code className="graph-setup__cmd">{previewCommand(opts)}</code>
      </form>

      {error && <div className="banner banner--error">{error}</div>}

      {opts.style === "forest" && result && !result.forestAvailable && (
        <div className="banner banner--warn">
          <code>git-foresta</code> isn't installed. Install a viewer (e.g.{" "}
          <code>git-foresta</code>) on the server's PATH, or use the <strong>Pretty</strong> style —
          it's colored and needs no extra tools.
        </div>
      )}

      {loading && !result ? (
        <p className="muted status__msg">Running…</p>
      ) : result && !result.available ? (
        <p className="muted status__msg">Repository unavailable — path missing or not a git repo.</p>
      ) : result && result.text.trim() === "" ? (
        !(opts.style === "forest" && !result.forestAvailable) && (
          <p className="muted status__msg">No output.</p>
        )
      ) : result ? (
        <pre className="graph-output">
          {opts.style === "plain" ? result.text : <AnsiText text={result.text} />}
        </pre>
      ) : null}
    </div>
  );
}

function WorktreesTab({
  repoId,
  reloadKey,
  selectedWorktree,
  onSelectWorktree,
}: {
  repoId: string;
  reloadKey: number;
  selectedWorktree: string | null;
  onSelectWorktree: (path: string | null) => void;
}) {
  const [worktrees, setWorktrees] = useState<Worktree[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWorktrees(await fetchWorktrees(repoId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (error) return <div className="banner banner--error">{error}</div>;
  if (loading && !worktrees) return <p className="muted status__msg">Discovering worktrees…</p>;
  if (!worktrees) return null;
  if (worktrees.length === 0)
    return <p className="muted status__msg">Repository unavailable — path missing or not a git repo.</p>;

  const linked = worktrees.filter((w) => !w.isMain);
  const isActive = (w: Worktree) => (w.isMain ? selectedWorktree === null : selectedWorktree === w.path);

  return (
    <>
      <p className="muted status__count">
        {linked.length === 0
          ? "No linked worktrees — just the main working tree."
          : `${linked.length} linked worktree${linked.length === 1 ? "" : "s"} (plus the main working tree). Click one to make it the active working tree.`}
      </p>
      <ul className="worktrees">
        {worktrees.map((w) => {
          const active = isActive(w);
          return (
            <li key={w.path}>
              <button
                type="button"
                className={`wt${active ? " wt--active" : ""}`}
                aria-pressed={active}
                onClick={() => onSelectWorktree(w.isMain ? null : w.path)}
              >
                <div className="wt__tags">
                  {active && <span className="chip chip--wt">active</span>}
                  {w.isMain && <span className="badge">main</span>}
                  {w.branch ? (
                    <span className="chip">{w.branch}</span>
                  ) : (
                    <span className="chip chip--muted">{w.isBare ? "bare" : "detached"}</span>
                  )}
                  {w.locked && (
                    <span className="chip chip--muted" title={w.lockedReason ?? "locked"}>
                      locked
                    </span>
                  )}
                  {w.prunable && <span className="chip chip--muted">prunable</span>}
                  {w.head && <code className="wt__sha">{w.head.slice(0, 8)}</code>}
                </div>
                <div className="wt__path">{w.path}</div>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
