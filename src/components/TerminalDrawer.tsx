import { useState, useRef, useEffect, FormEvent } from 'react';
import { X, Terminal as TerminalIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { Repository } from '../types';
import type { ExecResult } from '../api';
import { AnsiText } from './AnsiText';

interface TerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeRepo: Repository;
  selectedWorktree: string | null;
  /** Run a command in the active repo/worktree and resolve with its output + exit code. */
  onRunCommand: (command: string) => Promise<ExecResult>;
}

interface CommandEntry {
  command: string;
  output: string;
  code?: number;
  pending?: boolean;
}

const basename = (p: string) => p.split('/').filter(Boolean).pop() ?? p;

const HELP = [
  'Built-ins:  help, clear, exit',
  'Anything else runs in the shell in the active worktree —',
  'e.g.  git status · git log --oneline -5 · ls · npm run typecheck',
].join('\n');

export default function TerminalDrawer({
  isOpen,
  onClose,
  activeRepo,
  selectedWorktree,
  onRunCommand,
}: TerminalDrawerProps) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<CommandEntry[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const where = selectedWorktree ? basename(selectedWorktree) : basename(activeRepo.path) || 'main';
  const prompt = `${activeRepo.name || 'repo'}:${where}$`;

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleCommandSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const raw = input.trim();
    if (!raw || busy) return;
    setInput('');

    const lower = raw.toLowerCase();
    if (lower === 'clear') {
      setHistory([]);
      return;
    }
    if (lower === 'exit') {
      onClose();
      return;
    }
    if (lower === 'help') {
      setHistory((prev) => [...prev, { command: raw, output: HELP, code: 0 }]);
      return;
    }
    if (!activeRepo.id) {
      setHistory((prev) => [...prev, { command: raw, output: 'No repository selected.', code: 1 }]);
      return;
    }

    // Real execution on the server.
    setBusy(true);
    setHistory((prev) => [...prev, { command: raw, output: '', pending: true }]);
    try {
      const r = await onRunCommand(raw);
      setHistory((prev) => {
        const next = [...prev];
        next[next.length - 1] = { command: raw, output: r.output || '(no output)', code: r.code };
        return next;
      });
    } catch (err) {
      setHistory((prev) => {
        const next = [...prev];
        next[next.length - 1] = { command: raw, output: (err as Error).message, code: 1 };
        return next;
      });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-[#0d0e12]/80 backdrop-blur-sm z-50 flex items-end justify-center select-none font-mono">
      <motion.div
        initial={{ y: 300, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 300, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="w-full max-w-6xl h-[60vh] bg-surface-container border-t border-outline-variant shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Terminal Header */}
        <div
          onClick={() => inputRef.current?.focus()}
          className="bg-surface-container-high px-4 py-3 border-b border-outline-variant flex justify-between items-center cursor-text shrink-0"
        >
          <div className="flex items-center gap-2">
            <TerminalIcon className="w-4 h-4 text-secondary" />
            <span className="text-xs font-bold text-on-surface">Session Terminal</span>
            <span className="text-[10px] text-outline">— {where}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-outline hover:text-on-surface hover:bg-surface-container-low rounded-full transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Command stream */}
        <div
          onClick={() => inputRef.current?.focus()}
          className="flex-1 overflow-y-auto p-4 bg-[#0d0e12] font-mono text-xs leading-relaxed text-on-surface-variant cursor-text flex flex-col space-y-3"
        >
          {history.length === 0 && (
            <div className="text-outline">
              Commands run in <span className="text-secondary">{where}</span>. Type{' '}
              <span className="text-secondary">help</span> for built-ins.
            </div>
          )}

          {history.map((h, index) => (
            <div key={index} className="space-y-1">
              <div className="flex items-center gap-2 text-primary font-bold">
                <span>{prompt}</span>
                <span className="text-on-surface font-normal">{h.command}</span>
              </div>
              {h.pending ? (
                <div className="pl-2 text-outline animate-pulse">running…</div>
              ) : (
                <pre
                  className={`whitespace-pre-wrap break-words pl-2 font-mono ${
                    h.code && h.code !== 0 ? 'text-error/90' : 'text-on-surface-variant'
                  }`}
                >
                  <AnsiText text={h.output} />
                  {h.code && h.code !== 0 ? `\n[exit ${h.code}]` : ''}
                </pre>
              )}
            </div>
          ))}
          <div ref={bottomRef} />

          {/* Prompt line */}
          <form
            onSubmit={handleCommandSubmit}
            className="flex items-center gap-2 text-primary font-bold select-none shrink-0 pt-1"
          >
            <span>{prompt}</span>
            <div className="flex-1 flex items-center relative">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={busy}
                className="w-full bg-transparent border-none text-on-surface focus:outline-none p-0 focus:ring-0 font-normal font-mono text-xs disabled:opacity-60"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
              />
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
