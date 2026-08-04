import { useEffect, useState, FormEvent } from 'react';
import { X, Folder, FolderOpen, ArrowUp, Check, AlertTriangle, CheckCircle, Info, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Repository } from '../types';
import { browseDir } from '../api';
import type { BrowseResult } from '../../shared/types.ts';

interface AddRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (repo: { name: string; activeBranch: string; path: string }) => void;
}

export function AddRepoModal({
  isOpen,
  onClose,
  onSubmit
}: AddRepoModalProps) {
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('main');
  const [path, setPath] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const basename = (p: string) => p.split('/').filter(Boolean).pop() ?? '';

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const finalPath = path.trim();
    if (!finalPath) return;

    // The backend indexes an existing repo by its path and derives the real
    // name/branch itself; we submit the path as-is.
    onSubmit({
      name: name || basename(finalPath),
      activeBranch: branch,
      path: finalPath
    });

    setName('');
    setBranch('main');
    setPath('');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 bg-[#0d0e12]/85 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none font-mono text-xs">
          <motion.div
            initial={{ scale: 0.95, y: 15, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 15, opacity: 0 }}
            className="bg-surface-container border border-outline-variant rounded-xl max-w-md w-full overflow-hidden shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="p-4 border-b border-outline-variant bg-surface-container-high flex justify-between items-center">
              <span className="font-sans font-bold text-sm text-on-surface flex items-center gap-2">
                <Folder className="w-4 h-4 text-primary" />
                Add Local Repository
              </span>
              <button 
                onClick={onClose}
                className="p-1 text-outline hover:text-on-surface hover:bg-surface-container rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="text-outline block mb-1 text-[10px] font-bold uppercase">
                  Display Name <span className="text-outline/60 normal-case">(optional — defaults to folder name)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. ecommerce-backend"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-on-surface focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-outline block mb-1 text-[10px] font-bold uppercase">
                  Active Head Branch <span className="text-outline/60 normal-case">(detected from the repo)</span>
                </label>
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-on-surface focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="text-outline block mb-1 text-[10px] font-bold uppercase">
                  Absolute Path to Existing Repo
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="/home/mpb/Documents/GitHub/my-repo"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    className="flex-1 bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-on-surface focus:border-primary focus:outline-none min-w-0"
                  />
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2 border border-outline-variant rounded-lg text-on-surface hover:bg-surface-container-high transition-colors"
                  >
                    <FolderOpen className="w-4 h-4 text-primary" />
                    Browse…
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="p-4 border-t border-outline-variant bg-surface-container-high -mx-5 -mb-5 mt-6 flex justify-end gap-3">
                <button 
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-outline-variant rounded-lg hover:bg-surface-container transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-primary text-on-primary-container font-semibold rounded-lg hover:opacity-90 transition-colors"
                >
                  Index Repository
                </button>
              </div>
            </form>
          </motion.div>

          {pickerOpen && (
            <FolderPicker
              initialPath={path.trim() || undefined}
              onClose={() => setPickerOpen(false)}
              onSelect={(p) => {
                setPath(p);
                if (!name) setName(basename(p));
                setPickerOpen(false);
              }}
            />
          )}
        </div>
      )}
    </AnimatePresence>
  );
}

/** A filesystem folder picker backed by GET /api/browse — navigate directories and pick one. */
function FolderPicker({
  initialPath,
  onSelect,
  onClose,
}: {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [dir, setDir] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = (p?: string) => {
    setLoading(true);
    setError(null);
    browseDir(p)
      .then(setDir)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    go(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 bg-[#0d0e12]/85 backdrop-blur-sm z-[60] flex items-center justify-center p-4 select-none font-mono text-xs">
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="bg-surface-container border border-outline-variant rounded-xl max-w-lg w-full h-[70vh] overflow-hidden shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="p-4 border-b border-outline-variant bg-surface-container-high flex justify-between items-center shrink-0">
          <span className="font-sans font-bold text-sm text-on-surface flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-primary" />
            Choose repository folder
          </span>
          <button onClick={onClose} className="p-1 text-outline hover:text-on-surface hover:bg-surface-container rounded-full">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Current path + up */}
        <div className="px-3 py-2 border-b border-outline-variant bg-surface-container-low flex items-center gap-2 shrink-0">
          <button
            onClick={() => dir?.parent && go(dir.parent)}
            disabled={!dir?.parent || loading}
            title="Parent folder"
            className="p-1.5 rounded border border-outline-variant text-on-surface hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <span className="truncate text-on-surface-variant" title={dir?.path}>
            {dir?.path ?? '…'}
          </span>
          {dir?.isGitRepo && (
            <span className="ml-auto shrink-0 text-[9px] uppercase font-bold text-secondary bg-secondary/15 px-1.5 py-0.5 rounded">
              git repo
            </span>
          )}
        </div>

        {/* Directory listing */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading && <div className="p-4 text-outline animate-pulse">Loading…</div>}
          {error && <div className="p-4 text-error whitespace-pre-wrap">{error}</div>}
          {!loading && !error && dir?.entries.length === 0 && (
            <div className="p-4 text-outline">No sub-folders here.</div>
          )}
          {!loading &&
            !error &&
            dir?.entries.map((e) => (
              <div
                key={e.path}
                onClick={() => go(e.path)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-surface-container-high cursor-pointer group"
              >
                {e.isGitRepo ? (
                  <FolderOpen className="w-4 h-4 text-secondary shrink-0" />
                ) : (
                  <Folder className="w-4 h-4 text-outline shrink-0" />
                )}
                <span className="truncate text-on-surface">{e.name}</span>
                {e.isGitRepo && (
                  <>
                    <span className="ml-auto shrink-0 text-[9px] uppercase font-bold text-secondary">repo</span>
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onSelect(e.path);
                      }}
                      className="shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase border border-primary/40 text-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Select
                    </button>
                  </>
                )}
              </div>
            ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-outline-variant bg-surface-container-high flex items-center justify-between gap-3 shrink-0">
          <span className="text-[10px] text-outline truncate">
            {dir?.isGitRepo ? 'This folder is a git repo.' : 'Open a folder, or select one that contains .git.'}
          </span>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-outline-variant rounded-lg hover:bg-surface-container transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => dir && onSelect(dir.path)}
              disabled={!dir}
              className="px-4 py-2 bg-primary text-on-primary-container font-semibold rounded-lg hover:opacity-90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              Use this folder
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

interface ToastNotificationProps {
  message: string;
  type: 'success' | 'warning' | 'info';
  onClose: () => void;
}

export function ToastNotification({
  message,
  type,
  onClose
}: ToastNotificationProps) {
  return (
    <motion.div 
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -50, opacity: 0 }}
      className={`fixed top-4 right-4 z-50 p-4 border rounded-xl shadow-2xl flex items-center gap-3 font-mono text-xs max-w-sm ${
        type === 'success' ? 'bg-secondary/15 border-secondary/30 text-secondary' :
        type === 'warning' ? 'bg-tertiary/15 border-tertiary/30 text-tertiary' : 'bg-primary/15 border-primary/30 text-primary'
      }`}
    >
      {type === 'success' && <CheckCircle className="w-5 h-5 shrink-0 text-secondary" />}
      {type === 'warning' && <AlertTriangle className="w-5 h-5 shrink-0 text-tertiary" />}
      {type === 'info' && <Info className="w-5 h-5 shrink-0 text-primary" />}
      
      <div className="flex-1 pr-2 leading-relaxed">{message}</div>
      
      <button 
        onClick={onClose}
        className="p-1 hover:bg-surface-container rounded-full text-outline hover:text-on-surface shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}
