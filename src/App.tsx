import { useCallback, useEffect, useState } from 'react';
import { Repository, FileChange, Commit, Worktree } from './types';
import {
  fetchRepos,
  fetchHealth,
  fetchDiffs,
  fetchLog,
  fetchWorktrees,
  setSelection,
  setWorktreeSelection,
  commitChanges,
  suggestCommitMessage,
  addRepo,
  mergeWorktree,
  syncWorktreeFromMain,
  fetchCommitDetail,
  fetchGraph,
  fetchCompare,
  checkoutRef,
  createWorktree,
  removeWorktree,
  deleteBranch,
  mergeBranch,
  execCommand,
} from './api';
import { toRepository, logToCommits, worktreesToView, avatarFor } from './adapters';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import ChangesView from './components/ChangesView';
import HistoryView from './components/HistoryView';
import WorktreesView from './components/WorktreesView';
import CompareView from './components/CompareView';
import ReleaseView from './components/ReleaseView';
import SettingsView from './components/SettingsView';
import TerminalDrawer from './components/TerminalDrawer';
import { AddRepoModal, ToastNotification } from './components/Modals';
import { AnimatePresence } from 'motion/react';

const EMPTY_REPO: Repository = { id: '', name: 'No repository', activeBranch: '—', path: '' };
type ToastType = 'success' | 'warning' | 'info';

export default function App() {
  const [activeView, setActiveView] = useState<'changes' | 'history' | 'worktrees' | 'compare' | 'release' | 'settings'>('history');

  // Server-owned state (source of truth = the API; no localStorage).
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [activeRepo, setActiveRepo] = useState<Repository>(EMPTY_REPO);
  const [selectedWorktree, setSelectedWorktree] = useState<string | null>(null);
  const [fileChanges, setFileChanges] = useState<FileChange[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);

  // Purely-local prefs (kept in localStorage).
  const [devProfile, setDevProfile] = useState(() => {
    const saved = localStorage.getItem('sm_dev_profile');
    return saved
      ? JSON.parse(saved)
      : { name: 'Developer', email: '', avatar: '' };
  });
  useEffect(() => localStorage.setItem('sm_dev_profile', JSON.stringify(devProfile)), [devProfile]);

  // UI helpers
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const showToast = (message: string, type: ToastType = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Load the per-repo/worktree data (Changes/History/Worktrees).
  const loadRepoData = useCallback(async (repoId: string, worktree: string | null) => {
    if (!repoId) return;
    const [diffs, log, wts] = await Promise.all([
      fetchDiffs(repoId, worktree),
      fetchLog(repoId, 50),
      fetchWorktrees(repoId),
    ]);
    setFileChanges(diffs);
    setCommits(logToCommits(log));
    setWorktrees(worktreesToView(wts, worktree));
  }, []);

  // Re-run just the git log with History's controls (limit + all branches).
  const handleQueryLog = useCallback(
    async (opts: { limit: number; all: boolean }) => {
      if (!activeRepo.id) return;
      setHistoryLoading(true);
      try {
        const log = await fetchLog(activeRepo.id, opts.limit, opts.all);
        setCommits(logToCommits(log));
      } catch (err) {
        showToast((err as Error).message, 'warning');
      } finally {
        setHistoryLoading(false);
      }
    },
    [activeRepo.id],
  );

  // Initial load: repos + persisted selection, then that repo's data.
  useEffect(() => {
    (async () => {
      try {
        const { repos, selectedId, selectedWorktree: sw } = await fetchRepos();
        const mapped = repos.map(toRepository);
        setRepositories(mapped);
        const active = mapped.find((r) => r.id === selectedId) ?? mapped[0] ?? EMPTY_REPO;
        setActiveRepo(active);
        setSelectedWorktree(sw);
        if (active.id) await loadRepoData(active.id, sw);
      } catch (err) {
        showToast((err as Error).message, 'warning');
      }
    })();
  }, [loadRepoData]);

  // Switch repository (persists server-side, resets to main worktree).
  const selectRepo = async (repo: Repository) => {
    setActiveRepo(repo);
    setSelectedWorktree(null);
    try {
      await setSelection(repo.id);
      await loadRepoData(repo.id, null);
    } catch (err) {
      showToast((err as Error).message, 'warning');
    }
  };

  const handleSyncRepo = async () => {
    if (!activeRepo.id) return;
    setIsSyncing(true);
    try {
      const { repos } = await fetchRepos();
      setRepositories(repos.map(toRepository));
      await loadRepoData(activeRepo.id, selectedWorktree);
      showToast('Refreshed from disk.', 'success');
    } catch (err) {
      showToast((err as Error).message, 'warning');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleAddRepoSubmit = async (newRepo: { name: string; activeBranch: string; path: string }) => {
    try {
      const created = await addRepo(newRepo.path);
      const { repos, selectedId, selectedWorktree: sw } = await fetchRepos();
      const mapped = repos.map(toRepository);
      setRepositories(mapped);
      const active = mapped.find((r) => r.id === (selectedId ?? created.id)) ?? EMPTY_REPO;
      setActiveRepo(active);
      setSelectedWorktree(sw);
      if (active.id) await loadRepoData(active.id, sw);
      showToast(`Indexed repository ${created.name}.`, 'success');
    } catch (err) {
      showToast((err as Error).message, 'warning');
    }
  };

  // Commit staged changes. A non-empty `message` is used verbatim; otherwise the
  // server AI-generates one. Returns the result (hash + message) so the view can log it.
  const handleCommitSubmit = async (message?: string) => {
    if (!activeRepo.id) return undefined;
    try {
      const r = await commitChanges(activeRepo.id, selectedWorktree, message?.trim() || undefined);
      showToast(`Committed ${r.hash}: ${r.subject}`, 'success');
      await loadRepoData(activeRepo.id, selectedWorktree);
      return r;
    } catch (err) {
      showToast((err as Error).message, 'warning');
      return undefined;
    }
  };

  // Ask the server for an AI-suggested commit message (no commit).
  const handleSuggestMessage = () => suggestCommitMessage(activeRepo.id, selectedWorktree);

  // Run a shell command in the active repo/worktree (Terminal drawer).
  const handleRunCommand = useCallback(
    (command: string) => execCommand(activeRepo.id, command, selectedWorktree),
    [activeRepo.id, selectedWorktree],
  );

  // Fetch a rendered git-log graph (History → Graph mode).
  const handleLoadGraph = useCallback(
    (opts: { style: 'pretty' | 'forest'; all: boolean; limit: number }) =>
      fetchGraph(
        activeRepo.id,
        { style: opts.style, all: opts.all, decorate: true, oneline: false, graph: true, limit: opts.limit },
        selectedWorktree,
      ),
    [activeRepo.id, selectedWorktree],
  );

  // Fetch the branch/worktree divergence matrix (Compare tab).
  const handleLoadCompare = useCallback(
    (base?: string) => fetchCompare(activeRepo.id, base),
    [activeRepo.id],
  );

  // Remove a fully-merged, clean worktree (Compare tab prune action).
  const handlePruneWorktree = useCallback(
    (path: string) => removeWorktree(activeRepo.id, path),
    [activeRepo.id],
  );

  // Delete a fully-merged local branch (Compare tab prune action).
  const handleDeleteBranch = useCallback(
    (branch: string) => deleteBranch(activeRepo.id, branch),
    [activeRepo.id],
  );

  // Merge a branch into the base (Compare tab merge action).
  const handleMergeBranch = useCallback(
    (branch: string, into: string) => mergeBranch(activeRepo.id, branch, into),
    [activeRepo.id],
  );

  // Check out a ref in the main working tree (Compare tab "checkout main" action).
  const handleCompareCheckout = useCallback(
    (ref: string) => checkoutRef(activeRepo.id, ref, null),
    [activeRepo.id],
  );

  // Fetch a commit's full detail (files + diff) for the History inspector.
  const loadCommit = useCallback(
    (hash: string) => fetchCommitDetail(activeRepo.id, hash, selectedWorktree),
    [activeRepo.id, selectedWorktree],
  );

  const handleCheckoutCommit = async (hash: string) => {
    if (!activeRepo.id) return;
    if (
      !window.confirm(
        `Check out commit ${hash}?\n\n` +
          `This moves the working tree to a detached HEAD at ${hash}. It refuses if you have ` +
          `uncommitted changes; you can return afterwards with \`git switch -\`.`,
      )
    ) {
      return;
    }
    try {
      const r = await checkoutRef(activeRepo.id, hash, selectedWorktree);
      showToast(
        r.detached ? `Checked out ${r.head} (detached HEAD).` : `Checked out ${r.branch}.`,
        'success',
      );
      const { repos } = await fetchRepos();
      setRepositories(repos.map(toRepository));
      await loadRepoData(activeRepo.id, selectedWorktree);
    } catch (err) {
      showToast((err as Error).message, 'warning');
    }
  };

  const handleSelectWorktree = async (id: string) => {
    if (!activeRepo.id) return;
    const wt = worktrees.find((w) => w.id === id);
    if (!wt) return;
    const path = wt.status === 'main' ? null : wt.path;
    setSelectedWorktree(path);
    try {
      await setWorktreeSelection(path);
      await loadRepoData(activeRepo.id, path);
      showToast(`Active worktree → ${wt.name}.`, 'success');
    } catch (err) {
      showToast((err as Error).message, 'warning');
    }
  };

  const handleCreateWorktree = async (newWt: Omit<Worktree, 'id' | 'isActive'>) => {
    if (!activeRepo.id) return;
    try {
      const r = await createWorktree(activeRepo.id, { path: newWt.path, branch: newWt.branch });
      showToast(`Created worktree '${r.branch}' at ${r.path}.`, 'success');
      await loadRepoData(activeRepo.id, selectedWorktree);
    } catch (err) {
      showToast((err as Error).message, 'warning');
    }
  };

  const handleMergeWorktree = async (path: string) => {
    if (!activeRepo.id) return;
    const wt = worktrees.find((w) => w.path === path);
    try {
      const r = await mergeWorktree(activeRepo.id, path);
      showToast(
        r.alreadyUpToDate ? `${wt?.branch ?? 'branch'} already up to date with main.` : `Merged ${r.source} → ${r.target}.`,
        'success',
      );
      await loadRepoData(activeRepo.id, selectedWorktree);
    } catch (err) {
      showToast((err as Error).message, 'warning');
    }
  };

  const handleSyncWorktree = async (path: string) => {
    if (!activeRepo.id) return;
    const wt = worktrees.find((w) => w.path === path);
    try {
      const r = await syncWorktreeFromMain(activeRepo.id, path);
      showToast(
        r.alreadyUpToDate ? `${wt?.branch ?? 'branch'} already up to date with main.` : `Synced ${r.source} → ${r.target}.`,
        'success',
      );
      await loadRepoData(activeRepo.id, selectedWorktree);
    } catch (err) {
      showToast((err as Error).message, 'warning');
    }
  };

  return (
    <div className="bg-surface-container-lowest text-on-surface font-sans overflow-hidden h-screen flex flex-col antialiased">
      <Header
        activeView={activeView}
        setActiveView={setActiveView}
        activeRepo={activeRepo}
        onAddLocalRepo={() => setAddRepoOpen(true)}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        userName={devProfile.name}
        userAvatar={devProfile.avatar || avatarFor(devProfile.name || 'Developer')}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeView={activeView}
          setActiveView={setActiveView}
          repositories={repositories}
          activeRepo={activeRepo}
          setActiveRepo={selectRepo}
          onSync={handleSyncRepo}
          isSyncing={isSyncing}
          onOpenTerminal={() => setTerminalOpen(true)}
        />

        <main className="flex-1 ml-[280px] mt-16 flex flex-col overflow-hidden bg-surface-container-lowest relative">
          {activeView === 'changes' && (
            <ChangesView
              fileChanges={fileChanges}
              onCommit={handleCommitSubmit}
              onGenerateMessage={handleSuggestMessage}
              onSync={handleSyncRepo}
              onMerge={() => showToast('Merge is available from the Worktrees view.', 'info')}
            />
          )}
          {activeView === 'history' && (
            <HistoryView
              commits={commits}
              repoName={activeRepo.name}
              repoPath={activeRepo.path}
              branch={activeRepo.activeBranch}
              onLoadCommit={loadCommit}
              onCheckout={handleCheckoutCommit}
              onQueryLog={handleQueryLog}
              onLoadGraph={handleLoadGraph}
              loading={historyLoading}
              searchQuery={searchQuery}
            />
          )}
          {activeView === 'worktrees' && (
            <WorktreesView
              worktrees={worktrees}
              repoName={activeRepo.name}
              onSelectWorktree={handleSelectWorktree}
              onCreateWorktree={handleCreateWorktree}
              onMerge={handleMergeWorktree}
              onSync={handleSyncWorktree}
              onRefresh={handleSyncRepo}
            />
          )}
          {activeView === 'compare' && (
            <CompareView
              repoName={activeRepo.name}
              onLoadCompare={handleLoadCompare}
              onPrune={handlePruneWorktree}
              onDeleteBranch={handleDeleteBranch}
              onMergeBranch={handleMergeBranch}
              onCheckout={handleCompareCheckout}
            />
          )}
          {activeView === 'release' && (
            <ReleaseView
              repoId={activeRepo.id}
              worktree={selectedWorktree}
              onRefresh={() => loadRepoData(activeRepo.id, selectedWorktree)}
            />
          )}
          {activeView === 'settings' && (
            <SettingsView devProfile={devProfile} setDevProfile={setDevProfile} onLoadHealth={fetchHealth} />
          )}
        </main>
      </div>

      <AddRepoModal isOpen={addRepoOpen} onClose={() => setAddRepoOpen(false)} onSubmit={handleAddRepoSubmit} />

      <TerminalDrawer
        isOpen={terminalOpen}
        onClose={() => setTerminalOpen(false)}
        activeRepo={activeRepo}
        selectedWorktree={selectedWorktree}
        onRunCommand={handleRunCommand}
      />

      <AnimatePresence>
        {toast && <ToastNotification message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AnimatePresence>
    </div>
  );
}
