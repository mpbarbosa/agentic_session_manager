import { useEffect, useMemo, useState } from "react";
import type { Repo } from "../shared/types.ts";
import { fetchRepos, setSelection, setWorktreeSelection } from "./api.ts";
import { RepoCard } from "./components/RepoCard.tsx";
import { SelectRepoModal } from "./components/SelectRepoModal.tsx";
import { StatusPanel } from "./components/StatusPanel.tsx";

export function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedWorktree, setSelectedWorktree] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { repos, selectedId, selectedWorktree } = await fetchRepos();
      setRepos(repos);
      setSelectedId(selectedId);
      setSelectedWorktree(selectedWorktree);
      setReloadKey((k) => k + 1); // also refresh the selected repo's status panel
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function selectRepo(id: string) {
    setSelectedId(id); // optimistic; persist in the background
    setSelectedWorktree(null); // switching repo resets to the main working tree
    setReloadKey((k) => k + 1);
    void setSelection(id).catch((err) => setError((err as Error).message));
  }

  function selectWorktree(path: string | null) {
    setSelectedWorktree(path); // optimistic
    setReloadKey((k) => k + 1); // re-run Changes/History against the new working tree
    void setWorktreeSelection(path).catch((err) => setError((err as Error).message));
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) =>
      [r.name, r.description, r.path, r.url].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [repos, query]);

  const selected = repos.find((r) => r.id === selectedId) ?? null;

  function handleAdded(repo: Repo) {
    setRepos((prev) => {
      const rest = prev.filter((r) => r.id !== repo.id);
      return [...rest, repo];
    });
    setSelectedId(repo.id);
    setModalOpen(false);
  }

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1 className="app__title">Agentic Session Manager</h1>
          <p className="app__subtitle">Select a repository to monitor</p>
        </div>
        <div className="app__actions">
          <button className="btn btn--primary" onClick={() => setModalOpen(true)}>
            + Add local repo
          </button>
          <button className="btn" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="toolbar">
        <input
          className="toolbar__search"
          type="search"
          placeholder="Filter repositories…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="toolbar__count">
          {filtered.length} / {repos.length}
        </span>
      </div>

      {error && (
        <div className="banner banner--error">
          Could not load repositories: {error}
        </div>
      )}

      {loading && repos.length === 0 ? (
        <p className="muted">Loading repositories…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">
          No repositories{query ? " match your filter" : " configured — add some to repos.config.json"}.
        </p>
      ) : (
        <ul className="repo-grid">
          {filtered.map((repo) => (
            <li key={repo.id}>
              <RepoCard
                repo={repo}
                selected={repo.id === selectedId}
                onSelect={() => selectRepo(repo.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <StatusPanel
          repoId={selected.id}
          reloadKey={reloadKey}
          selectedWorktree={selectedWorktree}
          onSelectWorktree={selectWorktree}
          onRefresh={() => void load()}
        />
      )}

      {modalOpen && (
        <SelectRepoModal onClose={() => setModalOpen(false)} onAdded={handleAdded} />
      )}
    </div>
  );
}
