import { useState } from 'react';
import { FileChange, DiffLine } from '../types';
import type { CommitResult } from '../api';
import { 
  Folder, 
  FolderOpen, 
  FileText, 
  CheckSquare, 
  Square, 
  Sparkles, 
  RefreshCw, 
  ChevronDown, 
  ChevronRight,
  GitMerge,
  Terminal,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ChangesViewProps {
  fileChanges: FileChange[];
  /** Commit; an empty message lets the server AI-generate one. Resolves to the result. */
  onCommit: (message?: string) => Promise<CommitResult | undefined>;
  /** Ask the server for an AI-suggested message (no commit). */
  onGenerateMessage: () => Promise<string>;
  onSync: () => void;
  onMerge: () => void;
}

export default function ChangesView({
  fileChanges,
  onCommit,
  onGenerateMessage,
  onSync,
  onMerge
}: ChangesViewProps) {
  const [selectedFile, setSelectedFile] = useState<FileChange>(fileChanges[0] || null);
  const [checkedFiles, setCheckedFiles] = useState<string[]>(fileChanges.map(f => f.path));
  const [expandedFolders, setExpandedFolders] = useState<string[]>(['scripts', 'src/i18n/catalogs', 'styles']);
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');
  const [aiCommitOpen, setAiCommitOpen] = useState(false);
  const [aiGeneratedMessage, setAiGeneratedMessage] = useState('');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [customCommitMessage, setCustomCommitMessage] = useState('');
  
  // Local session console logs (populated as the user stages/commits).
  const [logLines, setLogLines] = useState<string[]>([]);

  const toggleFolder = (folder: string) => {
    if (expandedFolders.includes(folder)) {
      setExpandedFolders(expandedFolders.filter(f => f !== folder));
    } else {
      setExpandedFolders([...expandedFolders, folder]);
    }
  };

  const toggleCheckFile = (path: string) => {
    if (checkedFiles.includes(path)) {
      setCheckedFiles(checkedFiles.filter(p => p !== path));
    } else {
      setCheckedFiles([...checkedFiles, path]);
    }
  };

  const toggleCheckAll = () => {
    if (checkedFiles.length === fileChanges.length) {
      setCheckedFiles([]);
    } else {
      setCheckedFiles(fileChanges.map(f => f.path));
    }
  };

  // Group files by directory
  const getFileTree = () => {
    const tree: { [key: string]: FileChange[] } = {};
    fileChanges.forEach(file => {
      const parts = file.path.split('/');
      let folderPath = '';
      if (parts.length > 1) {
        folderPath = parts.slice(0, -1).join('/');
      } else {
        folderPath = 'root';
      }
      if (!tree[folderPath]) {
        tree[folderPath] = [];
      }
      tree[folderPath].push(file);
    });
    return tree;
  };

  const fileTree = getFileTree();

  const [genError, setGenError] = useState<string | null>(null);

  // Ask the server (Claude) for a real commit-message suggestion from the current diff.
  const handleGenerateAiMessage = async () => {
    setIsGeneratingAi(true);
    setGenError(null);
    setAiGeneratedMessage('');
    try {
      setAiGeneratedMessage(await onGenerateMessage());
    } catch (err) {
      setGenError((err as Error).message);
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleCommitSubmit = async () => {
    // Prefer the typed message, else the generated suggestion; empty → server generates.
    const msg = customCommitMessage.trim() || aiGeneratedMessage.trim();
    const stamp = new Date().toLocaleTimeString();
    setLogLines(prev => [...prev, `[${stamp}] Committing ${checkedFiles.length} file(s)…`]);
    const result = await onCommit(msg || undefined);
    setCustomCommitMessage('');
    setAiGeneratedMessage('');
    setAiCommitOpen(false);
    if (result) {
      setLogLines(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] SUCCESS: ${result.hash} — ${result.subject}`,
      ]);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-surface-container-lowest">
      
      {/* LEFT COLUMN: Staged Changes Explorer */}
      <div className="w-[340px] border-r border-outline-variant flex flex-col bg-surface-container-lowest shrink-0 select-none">
        
        <div className="p-4 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
          <span className="font-mono text-[11px] uppercase tracking-wider text-outline font-bold">
            Staged Changes
          </span>
          
          <button 
            onClick={toggleCheckAll}
            className="flex items-center gap-1.5 text-[11px] text-primary font-mono hover:opacity-85"
          >
            {checkedFiles.length === fileChanges.length ? (
              <CheckSquare className="w-4 h-4 text-primary" />
            ) : (
              <Square className="w-4 h-4 text-outline" />
            )}
            <span>Select All</span>
          </button>
        </div>

        {/* Tree List */}
        <div className="flex-1 overflow-y-auto p-2 font-mono text-xs">
          {Object.entries(fileTree).map(([folderPath, files]) => {
            const isExpanded = expandedFolders.includes(folderPath);
            return (
              <div key={folderPath} className="mb-2">
                {/* Folder Header */}
                {folderPath !== 'root' && (
                  <div 
                    onClick={() => toggleFolder(folderPath)}
                    className="flex items-center gap-1 px-2 py-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded cursor-pointer transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    {isExpanded ? (
                      <FolderOpen className="w-4 h-4 text-tertiary shrink-0" />
                    ) : (
                      <Folder className="w-4 h-4 text-tertiary shrink-0" />
                    )}
                    <span className="truncate ml-1">{folderPath}/</span>
                  </div>
                )}

                {/* Files in Folder */}
                {isExpanded && (
                  <div className={folderPath !== 'root' ? "pl-4 mt-0.5 space-y-0.5" : "space-y-0.5"}>
                    {files.map(file => {
                      const isSelected = selectedFile?.path === file.path;
                      const isChecked = checkedFiles.includes(file.path);
                      
                      return (
                        <div 
                          key={file.path}
                          className={`group flex items-center justify-between rounded px-2 py-1.5 cursor-pointer transition-all ${
                            isSelected 
                              ? 'bg-surface-container-high text-primary border-l-2 border-primary font-semibold' 
                              : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'
                          }`}
                        >
                          <div 
                            onClick={() => setSelectedFile(file)}
                            className="flex items-center gap-2 flex-1 min-w-0"
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCheckFile(file.path);
                              }}
                              className="text-outline hover:text-primary transition-colors shrink-0"
                            >
                              {isChecked ? (
                                <CheckSquare className="w-3.5 h-3.5 text-primary" />
                              ) : (
                                <Square className="w-3.5 h-3.5 text-outline" />
                              )}
                            </button>
                            <FileText className="w-4 h-4 text-outline shrink-0" />
                            <span className="truncate">{file.name}</span>
                          </div>

                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                            file.status === 'A' ? 'bg-secondary/20 text-secondary' :
                            file.status === 'M' ? 'bg-tertiary/20 text-tertiary' : 'bg-error/20 text-error'
                          }`}>
                            {file.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          
          {fileChanges.length === 0 && (
            <div className="text-center py-8 text-outline">
              No files are currently staged or modified.
            </div>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: Code panel & Console logs */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        
        {/* Top toolbar */}
        <div className="p-4 border-b border-outline-variant flex justify-between items-center bg-surface-container-low shrink-0 select-none">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-on-surface font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              {selectedFile ? selectedFile.path : 'No file selected'}
            </span>
            <div className="flex bg-surface-container-lowest border border-outline-variant rounded p-0.5 text-[10px] font-mono">
              <button 
                onClick={() => setViewMode('unified')}
                className={`px-2 py-0.5 rounded transition-colors ${viewMode === 'unified' ? 'bg-surface-container-high text-primary' : 'text-outline'}`}
              >
                Unified
              </button>
              <button 
                onClick={() => setViewMode('split')}
                className={`px-2 py-0.5 rounded transition-colors ${viewMode === 'split' ? 'bg-surface-container-high text-primary' : 'text-outline'}`}
              >
                Split
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => {
                setAiCommitOpen(true);
                handleGenerateAiMessage();
              }}
              className="bg-surface-container border border-outline-variant px-3 py-1.5 rounded-lg text-xs font-mono text-on-surface hover:bg-surface-container-high transition-all flex items-center gap-1.5 shadow-sm"
            >
              <Sparkles className="w-3.5 h-3.5 text-tertiary" />
              AI Commit
            </button>
            <button 
              onClick={onSync}
              className="bg-surface-container border border-outline-variant px-3 py-1.5 rounded-lg text-xs font-mono text-on-surface hover:bg-surface-container-high transition-all flex items-center gap-1.5 shadow-sm"
            >
              <RefreshCw className="w-3.5 h-3.5 text-secondary" />
              Sync
            </button>
            <button 
              onClick={onMerge}
              className="bg-surface-container border border-outline-variant px-3 py-1.5 rounded-lg text-xs font-mono text-on-surface hover:bg-surface-container-high transition-all flex items-center gap-1.5 shadow-sm"
            >
              <GitMerge className="w-3.5 h-3.5 text-primary" />
              Merge
            </button>
          </div>
        </div>

        {/* Diff View Area */}
        <div className="flex-1 overflow-auto bg-[#0d0e12] font-mono text-xs p-4 leading-relaxed relative">
          {selectedFile ? (
            <div className="space-y-px max-w-5xl mx-auto">
              {selectedFile.diff.map((line, i) => {
                const isAdded = line.type === 'added';
                const isRemoved = line.type === 'removed';
                
                return (
                  <div 
                    key={i} 
                    className={`flex items-stretch min-h-[22px] rounded-sm transition-colors ${
                      isAdded ? 'bg-secondary/10 text-secondary' :
                      isRemoved ? 'bg-error/10 text-error' : 'text-on-surface-variant hover:bg-surface-container-low'
                    }`}
                  >
                    {/* Line numbers column */}
                    <div className="w-12 text-right select-none text-outline border-r border-outline-variant/30 pr-3 flex justify-end items-center py-0.5 font-semibold text-[10px]">
                      {isRemoved ? line.oldNum : isAdded ? '' : line.oldNum}
                    </div>
                    <div className="w-12 text-right select-none text-outline border-r border-outline-variant/30 pr-3 flex justify-end items-center py-0.5 font-semibold text-[10px]">
                      {isAdded ? line.newNum : isRemoved ? '' : line.newNum}
                    </div>

                    {/* Code block */}
                    <pre className="pl-4 py-0.5 overflow-x-auto whitespace-pre flex-1 font-mono">
                      {line.text}
                    </pre>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-outline select-none">
              Select a file from the list to view its code changes.
            </div>
          )}
        </div>

        {/* AI Commit Popup Modal Overlay */}
        <AnimatePresence>
          {aiCommitOpen && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[#0d0e12]/85 backdrop-blur-sm flex items-center justify-center p-4 z-40"
            >
              <motion.div 
                initial={{ scale: 0.95, y: 15 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.95, y: 15 }}
                className="bg-surface-container border border-outline-variant rounded-xl max-w-xl w-full overflow-hidden shadow-2xl flex flex-col font-mono text-xs"
              >
                <div className="p-4 border-b border-outline-variant bg-surface-container-high flex justify-between items-center">
                  <span className="font-bold text-on-surface flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-tertiary" />
                    AI-Assisted Commit Generator
                  </span>
                  <button 
                    onClick={() => setAiCommitOpen(false)}
                    className="p-1 text-outline hover:text-on-surface rounded-full hover:bg-surface-container"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-5 space-y-4">
                  <div>
                    <label className="text-outline block mb-1 text-[10px] font-bold uppercase">
                      Staged Files For Commit
                    </label>
                    <div className="flex flex-wrap gap-1.5 p-3 bg-surface-container-lowest border border-outline-variant rounded-lg max-h-24 overflow-y-auto">
                      {checkedFiles.map(path => (
                        <span key={path} className="px-2 py-0.5 bg-surface-container text-on-surface-variant border border-outline-variant rounded text-[10px]">
                          {path.split('/').pop()}
                        </span>
                      ))}
                      {checkedFiles.length === 0 && (
                        <span className="text-error text-[10px]">No files selected! You must check files first.</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-outline text-[10px] font-bold uppercase">
                        AI Generated Message
                      </label>
                      <button 
                        onClick={handleGenerateAiMessage}
                        disabled={isGeneratingAi}
                        className="text-[10px] text-primary hover:underline flex items-center gap-1"
                      >
                        <RefreshCw className={`w-3 h-3 ${isGeneratingAi ? 'animate-spin' : ''}`} />
                        Regenerate
                      </button>
                    </div>

                    <div className="p-4 bg-[#0d0e12] border border-outline-variant rounded-lg min-h-16 flex items-start font-mono text-[11px]">
                      {isGeneratingAi ? (
                        <div className="text-outline animate-pulse">Asking Claude to describe the diff…</div>
                      ) : genError ? (
                        <span className="text-error leading-relaxed whitespace-pre-wrap">{genError}</span>
                      ) : (
                        <span className="text-secondary leading-relaxed whitespace-pre-wrap">
                          {aiGeneratedMessage || 'Click "Generate" to suggest a message from the staged diff.'}
                          {!aiGeneratedMessage && <span className="terminal-cursor" />}
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="text-outline block mb-1 text-[10px] font-bold uppercase">
                      Override with custom message
                    </label>
                    <input
                      type="text"
                      placeholder="Enter custom commit message (optional)..."
                      value={customCommitMessage}
                      onChange={(e) => setCustomCommitMessage(e.target.value)}
                      className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-on-surface focus:border-primary focus:outline-none"
                    />
                  </div>
                </div>

                <div className="p-4 border-t border-outline-variant bg-surface-container-high flex justify-end gap-3">
                  <button 
                    onClick={() => setAiCommitOpen(false)}
                    className="px-4 py-2 border border-outline-variant rounded-lg hover:bg-surface-container transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleCommitSubmit}
                    disabled={checkedFiles.length === 0}
                    className="px-4 py-2 bg-primary text-on-primary-container font-semibold rounded-lg hover:opacity-90 transition-colors disabled:opacity-50"
                  >
                    Stage & Commit All
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* BOTTOM: Collapsible Session Log Console */}
        <div className="border-t border-outline-variant bg-surface-container-lowest font-mono text-xs select-none">
          <div className="bg-surface-container-low px-4 py-2.5 flex justify-between items-center border-b border-outline-variant text-[11px] font-bold text-outline">
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-secondary" />
              <span>Session Log</span>
              <span className="px-1.5 py-0.5 bg-secondary-container text-on-secondary-container rounded text-[9px] uppercase font-bold animate-pulse">
                Live
              </span>
            </div>
            
            <button 
              onClick={() => setLogLines([])}
              className="text-outline hover:text-on-surface transition-colors text-[10px]"
            >
              Clear Logs
            </button>
          </div>

          <div className="p-3 bg-[#0d0e12] overflow-y-auto max-h-36 min-h-24 font-mono text-[11px] leading-relaxed text-on-surface-variant flex flex-col space-y-1">
            {logLines.map((line, idx) => {
              const isInfo = line.includes('INFO');
              const isSuccess = line.includes('SUCCESS');
              const isAi = line.includes('AI-ANALYSIS') || line.includes('Logic flow');
              const isRunning = line.includes('RUNNING');
              
              return (
                <div 
                  key={idx}
                  className={`px-2 py-0.5 rounded-sm ${
                    isSuccess ? 'text-secondary bg-secondary/5' :
                    isAi ? 'text-tertiary bg-tertiary/5' :
                    isRunning ? 'text-primary bg-primary/5' : 'text-on-surface-variant'
                  }`}
                >
                  {line}
                </div>
              );
            })}
            <div className="text-on-surface flex items-center px-2">
              - <span className="terminal-cursor" />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
