import { Search, Settings, Plus } from 'lucide-react';
import { Repository } from '../types';

interface HeaderProps {
  activeView: 'changes' | 'history' | 'worktrees' | 'compare' | 'release' | 'settings';
  setActiveView: (view: 'changes' | 'history' | 'worktrees' | 'compare' | 'release' | 'settings') => void;
  activeRepo: Repository;
  onAddLocalRepo: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  userName: string;
  /** Self-contained avatar (data: URI or the user's own image); no external hosts. */
  userAvatar: string;
}

export default function Header({
  activeView,
  setActiveView,
  activeRepo,
  onAddLocalRepo,
  searchQuery,
  setSearchQuery,
  userName,
  userAvatar
}: HeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 h-16 bg-surface border-b border-outline-variant flex justify-between items-center px-6 shrink-0 z-50">
      
      {/* Logo & Section Tabs */}
      <div className="flex items-center gap-6">
        <span 
          onClick={() => setActiveView('history')}
          className="font-mono text-xl font-bold text-primary tracking-tight cursor-pointer hover:opacity-85 select-none"
        >
          Session Manager
        </span>
        
        {/* Horizontal Navigation */}
        <nav className="hidden md:flex items-center gap-2 ml-6 font-mono text-xs">
          <button
            onClick={() => setActiveView('changes')}
            className={`px-3 py-1.5 rounded transition-colors ${
              activeView === 'changes'
                ? 'text-primary bg-surface-container-high font-bold'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            Changes
          </button>
          
          <button
            onClick={() => setActiveView('history')}
            className={`px-3 py-1.5 border-b-2 font-bold transition-all ${
              activeView === 'history' || activeView === 'worktrees' || activeView === 'release'
                ? 'text-primary border-primary'
                : 'text-on-surface-variant border-transparent hover:bg-surface-container-high'
            }`}
          >
            {activeRepo.name}
          </button>
          
          <button
            onClick={() => setActiveView('settings')}
            className={`px-3 py-1.5 rounded transition-colors ${
              activeView === 'settings'
                ? 'text-primary bg-surface-container-high font-bold'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            Settings
          </button>
        </nav>
      </div>

      {/* Search & Tool Buttons */}
      <div className="flex items-center gap-4">
        
        {/* Dynamic Search Input */}
        <div className="relative hidden sm:block group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-outline" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search commits…"
            className="bg-surface-container-low border border-outline-variant rounded-lg pl-9 pr-4 py-1.5 text-xs font-mono text-on-surface focus:border-primary focus:outline-none focus:ring-0 w-64 transition-all"
          />
        </div>

        {/* Add Local Repo Button */}
        <button
          onClick={onAddLocalRepo}
          className="bg-primary text-on-primary-container px-4 py-2 rounded-lg font-mono text-xs font-semibold hover:opacity-90 active:scale-95 duration-100 flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          Add local repo
        </button>

        {/* Quick settings */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveView('settings')}
            className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {/* User Avatar (self-contained; no external hosts) */}
        <div className="w-8 h-8 rounded-full bg-outline-variant overflow-hidden border border-outline shrink-0">
          <img
            alt={userName ? `${userName}'s profile` : 'User profile'}
            className="w-full h-full object-cover"
            src={userAvatar}
          />
        </div>

      </div>
    </header>
  );
}
