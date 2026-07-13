import { useEffect, useState } from "react";
import type { BrowseResult, Repo } from "../../shared/types.ts";
import { addRepo, browseDir } from "../api.ts";

interface Props {
  onClose: () => void;
  onAdded: (repo: Repo) => void;
}

export function SelectRepoModal({ onClose, onAdded }: Props) {
  const [listing, setListing] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);

  async function navigate(dirPath?: string) {
    setLoading(true);
    setError(null);
    try {
      setListing(await browseDir(dirPath));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void navigate();
  }, []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function add(dirPath: string) {
    setBusyPath(dirPath);
    setError(null);
    try {
      onAdded(await addRepo(dirPath));
    } catch (err) {
      setError((err as Error).message);
      setBusyPath(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Select a local repository"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header">
          <h2 className="modal__title">Select a local repository</h2>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="browser__pathbar">
          <button
            className="btn btn--sm"
            onClick={() => listing?.parent && void navigate(listing.parent)}
            disabled={loading || !listing?.parent}
            title="Parent directory"
          >
            ↑ Up
          </button>
          <code className="browser__path">{listing?.path ?? "…"}</code>
        </div>

        {listing?.isGitRepo && (
          <div className="browser__current">
            <span>
              <span className="badge">git</span> This folder is a repository
            </span>
            <button
              className="btn btn--primary btn--sm"
              onClick={() => void add(listing.path)}
              disabled={busyPath !== null}
            >
              {busyPath === listing.path ? "Adding…" : "Add this folder"}
            </button>
          </div>
        )}

        {error && <div className="banner banner--error">{error}</div>}

        <div className="browser__list">
          {loading ? (
            <p className="muted browser__empty">Loading…</p>
          ) : listing && listing.entries.length === 0 ? (
            <p className="muted browser__empty">No subfolders here.</p>
          ) : (
            <ul>
              {listing?.entries.map((entry) => (
                <li key={entry.path} className="browser__row">
                  <button
                    className="browser__nav"
                    onClick={() => void navigate(entry.path)}
                    title={entry.path}
                  >
                    <span className="browser__folder">📁</span>
                    <span className="browser__name">{entry.name}</span>
                    {entry.isGitRepo && <span className="badge">git</span>}
                  </button>
                  {entry.isGitRepo && (
                    <button
                      className="btn btn--sm"
                      onClick={() => void add(entry.path)}
                      disabled={busyPath !== null}
                    >
                      {busyPath === entry.path ? "Adding…" : "Add"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
