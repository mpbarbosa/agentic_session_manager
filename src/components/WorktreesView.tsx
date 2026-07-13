import { useState, FormEvent } from 'react';
import { Worktree } from '../types';
import {
  Folder,
  FolderOpen,
  Cpu,
  Link2Off,
  CheckCircle2,
  Plus,
  RefreshCw,
  ArrowLeftRight,
  GitFork,
  X,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface WorktreesViewProps {
  worktrees: Worktree[];
  repoName: string;
  onSelectWorktree: (id: string) => void;
  onCreateWorktree: (wt: Omit<Worktree, 'id' | 'isActive'>) => void;
  /** Merge the active worktree's branch into main. */
  onMerge: (path: string) => void;
  /** Merge main into the active worktree's branch. */
  onSync: (path: string) => void;
  onRefresh: () => void;
}

export default function WorktreesView({
  worktrees,
  repoName,
  onSelectWorktree,
  onCreateWorktree,
  onMerge,
  onSync,
  onRefresh,
}: WorktreesViewProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWtName, setNewWtName] = useState('');
  const [newWtBranch, setNewWtBranch] = useState('');
  const [newWtPath, setNewWtPath] = useState('/home/mpb/Documents/GitHub/');
  const [newWtStatus, setNewWtStatus] = useState<'main' | 'active' | 'agora-dev' | 'agora-dev2' | 'agent' | 'detached'>('agora-dev');

  // Actions target the active worktree; disabled while main is active (nothing to merge/sync).
  const active = worktrees.find((w) => w.isActive);
  const linkedActive = active && active.status !== 'main' ? active : null;
  const linkedCount = worktrees.filter((w) => w.status !== 'main').length;

  const handleCreateSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!newWtPath.trim() || !newWtBranch.trim()) return;

    // Use the path field as-is — the name only seeds a default path (see the Name onChange).
    onCreateWorktree({
      name: newWtName,
      branch: newWtBranch.trim(),
      hash: '',
      path: newWtPath.trim(),
      status: newWtStatus
    });

    setNewWtName('');
    setNewWtBranch('');
    setShowCreateModal(false);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 font-sans relative bg-surface-container-lowest select-none">
      
      {/* Top Header Panel */}
      <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-on-surface mb-1 flex items-center gap-3">
            Worktrees
            {repoName && (
              <span className="text-[10px] font-mono text-outline font-semibold px-2 py-0.5 bg-surface-container-high rounded">
                {repoName}
              </span>
            )}
          </h2>
          <p className="text-xs text-on-surface-variant font-mono">
            {linkedCount} linked worktree{linkedCount === 1 ? '' : 's'} (plus the main working tree). Click one to make it the active working tree.
          </p>
        </div>

        <div className="flex gap-2 text-xs font-mono">
          <button
            onClick={() => linkedActive && onSync(linkedActive.path)}
            disabled={!linkedActive}
            title={linkedActive ? `Merge main into ${linkedActive.branch}` : 'Select a linked worktree first'}
            className="px-3 py-1.5 border border-outline-variant rounded bg-surface hover:bg-surface-container-high text-on-surface transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-primary" />
            <span>Sync ← main</span>
          </button>
          <button
            onClick={() => linkedActive && onMerge(linkedActive.path)}
            disabled={!linkedActive}
            title={linkedActive ? `Merge ${linkedActive.branch} into main` : 'Select a linked worktree first'}
            className="px-3 py-1.5 bg-primary/10 border border-primary/30 rounded text-primary font-bold hover:bg-primary/20 transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <GitFork className="w-3.5 h-3.5 text-primary" />
            <span>Merge → main</span>
          </button>
          <button
            onClick={onRefresh}
            className="px-3 py-1.5 border border-outline-variant rounded bg-surface hover:bg-surface-container-high text-on-surface transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5 text-secondary" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Worktrees Card Grid layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {worktrees.map((wt) => {
          const isActive = wt.isActive;
          
          // Custom icon selector for technical styling
          let WtIcon = Folder;
          if (isActive) WtIcon = FolderOpen;
          if (wt.status === 'agent') WtIcon = Cpu;
          if (wt.status === 'detached') WtIcon = Link2Off;

          return (
            <div
              key={wt.id}
              onClick={() => onSelectWorktree(wt.id)}
              className={`relative rounded-xl p-4 border cursor-pointer select-none transition-all ${
                isActive 
                  ? 'bg-surface-container-high border-2 border-primary shadow-[0_0_15px_rgba(59,130,246,0.15)] scale-[1.01]' 
                  : 'bg-surface-container-low border-outline-variant hover:border-outline hover:bg-surface-container transition-all hover:scale-[1.005]'
              }`}
            >
              {/* Top active check badge */}
              {isActive && (
                <div className="absolute top-4 right-4">
                  <CheckCircle2 className="w-4.5 h-4.5 text-primary" />
                </div>
              )}

              {/* Badges details info */}
              <div className="flex items-center gap-2 mb-3">
                <div className="flex gap-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold border ${
                    wt.status === 'main' ? 'bg-secondary/20 text-secondary border-secondary/30' :
                    isActive ? 'bg-tertiary/20 text-tertiary border-tertiary/30' : 'bg-primary/15 text-primary border-primary/20'
                  }`}>
                    {wt.status}
                  </span>
                  {isActive && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] uppercase font-bold bg-primary-container text-on-primary-container font-mono border border-primary/20">
                      {wt.branch}
                    </span>
                  )}
                </div>
                
                <span className="font-mono text-[10px] text-outline font-semibold">
                  {wt.hash}
                </span>
              </div>

              {/* Target Directory Location Path */}
              <div className="font-mono text-xs flex items-center gap-2 truncate">
                <WtIcon className={`w-4 h-4 shrink-0 ${
                  isActive ? 'text-primary' : 
                  wt.status === 'agent' ? 'text-tertiary' : 
                  wt.status === 'detached' ? 'text-error' : 'text-outline'
                }`} />
                <span className={isActive ? 'text-on-surface font-semibold' : 'text-on-surface-variant'}>
                  {wt.path}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* FLOATING ACTION BUTTON (FAB) FOR NEW WORKTREE */}
      <button 
        onClick={() => setShowCreateModal(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-primary text-on-primary rounded-full shadow-2xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all z-30 group"
      >
        <Plus className="w-6 h-6 text-on-primary" />
        
        {/* Animated label slide out */}
        <span className="absolute right-full mr-4 bg-surface-container-high text-on-surface px-3 py-2 rounded-lg text-xs font-mono font-bold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl border border-outline-variant">
          Create new worktree
        </span>
      </button>

      {/* CREATE WORKTREE MODAL POPUP DIALOG */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 bg-[#0d0e12]/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div 
              initial={{ scale: 0.95, y: 15, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 15, opacity: 0 }}
              className="bg-surface-container border border-outline-variant rounded-xl max-w-md w-full overflow-hidden shadow-2xl flex flex-col font-mono text-xs"
            >
              <div className="p-4 border-b border-outline-variant bg-surface-container-high flex justify-between items-center">
                <span className="font-sans font-bold text-sm text-on-surface flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Create New Worktree Workspace
                </span>
                <button 
                  onClick={() => setShowCreateModal(false)}
                  className="p-1 text-outline hover:text-on-surface rounded-full"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateSubmit} className="p-5 space-y-4">
                <div>
                  <label className="text-outline block mb-1 text-[10px] font-bold uppercase">
                    Worktree Directory Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. agora-patch-1"
                    value={newWtName}
                    onChange={(e) => {
                      setNewWtName(e.target.value);
                      if (e.target.value) {
                        setNewWtPath(`/home/mpb/Documents/GitHub/${e.target.value}`);
                      }
                    }}
                    className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-on-surface focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-outline block mb-1 text-[10px] font-bold uppercase">
                    Target Branch Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. patch-1"
                    value={newWtBranch}
                    onChange={(e) => setNewWtBranch(e.target.value)}
                    className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-on-surface focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-outline block mb-1 text-[10px] font-bold uppercase">
                    Absolute Path
                  </label>
                  <input
                    type="text"
                    required
                    value={newWtPath}
                    onChange={(e) => setNewWtPath(e.target.value)}
                    className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-on-surface focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-outline block mb-1 text-[10px] font-bold uppercase">
                    Workspace Role / Category
                  </label>
                  <select
                    value={newWtStatus}
                    onChange={(e: any) => setNewWtStatus(e.target.value)}
                    className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-on-surface focus:border-primary focus:outline-none"
                  >
                    <option value="agora-dev">Developer Draft (agora-dev)</option>
                    <option value="agora-dev2">Feature Workspace (agora-dev2)</option>
                    <option value="agent">Agent Managed (agent)</option>
                    <option value="detached">Detached HEAD Workspace (detached)</option>
                  </select>
                </div>

                <div className="p-4 border-t border-outline-variant bg-surface-container-high -mx-5 -mb-5 mt-6 flex justify-end gap-3">
                  <button 
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 border border-outline-variant rounded-lg hover:bg-surface-container transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="px-4 py-2 bg-primary text-on-primary-container font-semibold rounded-lg hover:opacity-90 transition-colors"
                  >
                    Generate Workspace
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
