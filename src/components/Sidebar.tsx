import { Repository } from '../types';
import { 
  Database, 
  RefreshCw, 
  FileCode, 
  History, 
  GitBranch, 
  Rocket, 
  Terminal, 
  Settings, 
  ChevronDown,
  ChevronsUpDown,
  FolderDot
} from 'lucide-react';
import { useState } from 'react';

interface SidebarProps {
  activeView: 'changes' | 'history' | 'worktrees' | 'release' | 'settings';
  setActiveView: (view: 'changes' | 'history' | 'worktrees' | 'release' | 'settings') => void;
  repositories: Repository[];
  activeRepo: Repository;
  setActiveRepo: (repo: Repository) => void;
  onSync: () => void;
  isSyncing: boolean;
  onOpenTerminal: () => void;
}

export default function Sidebar({
  activeView,
  setActiveView,
  repositories,
  activeRepo,
  setActiveRepo,
  onSync,
  isSyncing,
  onOpenTerminal
}: SidebarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <aside id="sidebar-container" className="fixed left-0 top-16 h-[calc(100vh-64px)] w-[280px] bg-surface-container-low border-r border-outline-variant flex flex-col py-4 z-40">
      
      {/* Current Workspace Panel */}
      <div className="px-4 mb-5">
        <div className="relative">
          <div 
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-3 bg-surface-container-high p-3 rounded-lg border border-outline-variant cursor-pointer hover:border-outline transition-all"
          >
            <div className="w-10 h-10 rounded bg-secondary-container flex items-center justify-center text-on-secondary-container shrink-0">
              <Database className="w-5 h-5 text-secondary" />
            </div>
            <div className="flex flex-col overflow-hidden text-left flex-1">
              <span className="font-mono text-xs text-on-surface font-semibold truncate">
                {activeRepo.name}
              </span>
              <span className="text-[10px] text-secondary opacity-90 truncate flex items-center gap-1 font-mono">
                <GitBranch className="w-3 h-3 text-secondary" />
                {activeRepo.activeBranch}
              </span>
            </div>
            <ChevronsUpDown className="w-4 h-4 text-on-surface-variant shrink-0" />
          </div>

          {dropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-surface-container-highest border border-outline-variant rounded-lg shadow-xl z-50 py-1 font-mono text-xs overflow-hidden">
              <div className="px-3 py-1 text-[10px] text-outline uppercase font-semibold">
                Switch Repository
              </div>
              {repositories.map((repo) => (
                <button
                  key={repo.id}
                  onClick={() => {
                    setActiveRepo(repo);
                    setDropdownOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-surface-container-high transition-colors ${
                    activeRepo.id === repo.id ? 'text-primary bg-surface-container-low' : 'text-on-surface-variant'
                  }`}
                >
                  <FolderDot className="w-3.5 h-3.5" />
                  <span className="truncate">{repo.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sync Button */}
        <button 
          onClick={onSync}
          disabled={isSyncing}
          className="w-full mt-3 py-2 bg-secondary text-on-secondary-fixed rounded-lg font-semibold hover:opacity-95 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-75"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Syncing Repo...' : 'Sync Repository'}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2">
        <button
          onClick={() => setActiveView('changes')}
          className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all duration-150 rounded font-mono text-xs text-left ${
            activeView === 'changes'
              ? 'bg-surface-container-high text-primary border-l-4 border-primary font-bold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
          }`}
        >
          <FileCode className="w-4 h-4 shrink-0" />
          <span>Changes</span>
        </button>

        <button
          onClick={() => setActiveView('history')}
          className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all duration-150 rounded font-mono text-xs text-left ${
            activeView === 'history'
              ? 'bg-surface-container-high text-primary border-l-4 border-primary font-bold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
          }`}
        >
          <History className="w-4 h-4 shrink-0" />
          <span>History</span>
        </button>

        <button
          onClick={() => setActiveView('worktrees')}
          className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all duration-150 rounded font-mono text-xs text-left ${
            activeView === 'worktrees'
              ? 'bg-surface-container-high text-primary border-l-4 border-primary font-bold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
          }`}
        >
          <GitBranch className="w-4 h-4 shrink-0" />
          <span>Worktrees</span>
        </button>

        <button
          onClick={() => setActiveView('release')}
          className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all duration-150 rounded font-mono text-xs text-left ${
            activeView === 'release'
              ? 'bg-surface-container-high text-primary border-l-4 border-primary font-bold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
          }`}
        >
          <Rocket className="w-4 h-4 shrink-0" />
          <span>Release</span>
        </button>
      </nav>

      {/* Footer Navigation */}
      <div className="mt-auto border-t border-outline-variant pt-2 space-y-1 px-2">
        <button
          onClick={onOpenTerminal}
          className="w-full flex items-center gap-3 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest px-4 py-2.5 rounded transition-all font-mono text-xs text-left"
        >
          <Terminal className="w-4 h-4 text-outline" />
          <span>Terminal</span>
        </button>
        <button
          onClick={() => setActiveView('settings')}
          className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all rounded font-mono text-xs text-left ${
            activeView === 'settings'
              ? 'bg-surface-container-high text-primary border-l-4 border-primary font-bold'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest'
          }`}
        >
          <Settings className="w-4 h-4 text-outline" />
          <span>Settings</span>
        </button>
      </div>

    </aside>
  );
}
