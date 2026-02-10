import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GitBranch,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Check,
  FileText,
  History,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const API_BASE = '/api';

interface GitFile {
  path: string;
  status: string;
  index_status: string;
  work_status: string;
  change_type: string;
}

interface GitStatus {
  branch: string;
  files: GitFile[];
  ahead: number;
  behind: number;
}

interface GitCommit {
  hash: string;
  short_hash: string;
  author: string;
  email: string;
  timestamp: number;
  message: string;
}

interface GitBranchInfo {
  name: string;
  current: boolean;
}

type ViewMode = 'changes' | 'log';

interface SourceControlProps {
  projectId: string;
  onOpenDiff?: (path: string, diff: string) => void;
  className?: string;
}

export function SourceControl({ projectId, onOpenDiff, className = '' }: SourceControlProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('changes');
  const [showBranches, setShowBranches] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    staged: true,
    changes: true,
    untracked: true,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/git/status`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed to get git status' }));
        throw new Error(err.detail);
      }
      const data: GitStatus = await res.json();
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get git status');
    }
  }, [projectId]);

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/git/log?limit=30`);
      if (!res.ok) return;
      const data = await res.json();
      setCommits(data.commits || []);
    } catch {
      // Ignore log errors
    }
  }, [projectId]);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/git/branches`);
      if (!res.ok) return;
      const data = await res.json();
      setBranches(data.branches || []);
    } catch {
      // Ignore branch errors
    }
  }, [projectId]);

  // Initial load
  useEffect(() => {
    setIsLoading(true);
    Promise.all([fetchStatus(), fetchLog(), fetchBranches()]).finally(() => setIsLoading(false));
  }, [fetchStatus, fetchLog, fetchBranches]);

  // Polling (reduced from 5s to 30s for performance)
  useEffect(() => {
    pollRef.current = setInterval(() => {
      // Only poll if tab is visible
      if (!document.hidden) {
        fetchStatus();
      }
    }, 30000); // Reduced from 5s to 30s

    // Pause/resume polling based on visibility
    const handleVisibilityChange = () => {
      if (!document.hidden && pollRef.current) {
        fetchStatus(); // Immediate update when tab becomes visible
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchStatus]);

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([fetchStatus(), fetchLog(), fetchBranches()]);
    setIsLoading(false);
  }, [fetchStatus, fetchLog, fetchBranches]);

  const handleStage = useCallback(async (files: string[]) => {
    setActionLoading('stage');
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/git/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Stage failed' }));
        throw new Error(err.detail);
      }
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stage failed');
    } finally {
      setActionLoading(null);
    }
  }, [projectId, fetchStatus]);

  const handleUnstage = useCallback(async (files: string[]) => {
    setActionLoading('unstage');
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/git/unstage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Unstage failed' }));
        throw new Error(err.detail);
      }
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unstage failed');
    } finally {
      setActionLoading(null);
    }
  }, [projectId, fetchStatus]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return;
    setActionLoading('commit');
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/git/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMessage }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Commit failed' }));
        throw new Error(err.detail);
      }
      setCommitMessage('');
      await Promise.all([fetchStatus(), fetchLog()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Commit failed');
    } finally {
      setActionLoading(null);
    }
  }, [projectId, commitMessage, fetchStatus, fetchLog]);

  const handlePush = useCallback(async () => {
    setActionLoading('push');
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/git/push`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Push failed' }));
        throw new Error(err.detail);
      }
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Push failed');
    } finally {
      setActionLoading(null);
    }
  }, [projectId, fetchStatus]);

  const handlePull = useCallback(async () => {
    setActionLoading('pull');
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/git/pull`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Pull failed' }));
        throw new Error(err.detail);
      }
      await Promise.all([fetchStatus(), fetchLog()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pull failed');
    } finally {
      setActionLoading(null);
    }
  }, [projectId, fetchStatus, fetchLog]);

  const handleCheckout = useCallback(async (branch: string) => {
    setActionLoading('checkout');
    setShowBranches(false);
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/git/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Checkout failed' }));
        throw new Error(err.detail);
      }
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
    } finally {
      setActionLoading(null);
    }
  }, [projectId, refreshAll]);

  const handleViewDiff = useCallback(async (file: GitFile) => {
    if (!onOpenDiff) return;
    try {
      const staged = file.status === 'staged';
      const res = await fetch(
        `${API_BASE}/projects/${projectId}/git/diff?file=${encodeURIComponent(file.path)}&staged=${staged}`
      );
      if (!res.ok) return;
      const data = await res.json();
      onOpenDiff(file.path, data.diff || '');
    } catch {
      // Ignore diff errors
    }
  }, [projectId, onOpenDiff]);

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Categorize files
  const stagedFiles = status?.files?.filter((f) => f.status === 'staged' || f.status === 'staged+modified') || [];
  const changedFiles = status?.files?.filter((f) => f.status === 'modified' || f.status === 'staged+modified') || [];
  const untrackedFiles = status?.files?.filter((f) => f.status === 'untracked') || [];

  const statusBadgeColor = (changeType: string) => {
    switch (changeType) {
      case 'A': return 'text-green-400';
      case 'D': return 'text-red-400';
      case 'M': return 'text-yellow-400';
      case 'R': return 'text-blue-400';
      case 'U': return 'text-gray-400';
      default: return 'text-gray-400';
    }
  };

  if (isLoading && !status) {
    return (
      <div className={cn('flex items-center justify-center h-full', className)}>
        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-text-muted)]" />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full text-sm', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9 border-b border-[var(--color-border)] flex-shrink-0">
        <span className="text-xs font-semibold text-[var(--color-text-primary)] uppercase tracking-wider">
          Source Control
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={refreshAll}
            className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Branch + Push/Pull */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--color-border)] flex-shrink-0">
        <div className="relative flex-1">
          <button
            onClick={() => { setShowBranches(!showBranches); if (!showBranches) fetchBranches(); }}
            className="flex items-center gap-1.5 text-xs text-[var(--color-text-primary)] hover:text-[var(--color-accent-primary)] transition-colors"
          >
            <GitBranch className="h-3.5 w-3.5" />
            <span className="truncate">{status?.branch || 'main'}</span>
            <ChevronDown className="h-3 w-3" />
          </button>
          {showBranches && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded shadow-lg z-50 max-h-48 overflow-y-auto">
              {branches.map((b) => (
                <button
                  key={b.name}
                  onClick={() => handleCheckout(b.name)}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--color-background)] transition-colors truncate',
                    b.current ? 'text-[var(--color-accent-primary)] font-medium' : 'text-[var(--color-text-primary)]'
                  )}
                >
                  {b.current && <Check className="h-3 w-3 inline mr-1" />}
                  {b.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={handlePull}
          disabled={actionLoading === 'pull'}
          className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)] rounded transition-colors disabled:opacity-50"
          title="Pull"
        >
          <ArrowDown className="h-3 w-3" />
          {(status?.behind ?? 0) > 0 && <span>{status?.behind}</span>}
        </button>
        <button
          onClick={handlePush}
          disabled={actionLoading === 'push'}
          className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)] rounded transition-colors disabled:opacity-50"
          title="Push"
        >
          <ArrowUp className="h-3 w-3" />
          {(status?.ahead ?? 0) > 0 && <span>{status?.ahead}</span>}
        </button>
      </div>

      {/* View mode tabs */}
      <div className="flex items-center border-b border-[var(--color-border)] flex-shrink-0">
        <button
          onClick={() => setViewMode('changes')}
          className={cn(
            'flex items-center gap-1 px-3 py-1.5 text-xs transition-colors',
            viewMode === 'changes'
              ? 'text-[var(--color-text-primary)] border-b-2 border-[var(--color-accent-primary)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
          )}
        >
          <FileText className="h-3 w-3" />
          Changes
        </button>
        <button
          onClick={() => { setViewMode('log'); fetchLog(); }}
          className={cn(
            'flex items-center gap-1 px-3 py-1.5 text-xs transition-colors',
            viewMode === 'log'
              ? 'text-[var(--color-text-primary)] border-b-2 border-[var(--color-accent-primary)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
          )}
        >
          <History className="h-3 w-3" />
          Log
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="px-3 py-2 text-xs text-red-400 bg-red-400/10 border-b border-[var(--color-border)]">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {viewMode === 'changes' ? (
        <div className="flex-1 overflow-y-auto">
          {/* Commit section */}
          <div className="px-3 py-2 border-b border-[var(--color-border)]">
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Commit message"
              className="w-full px-2 py-1.5 text-xs bg-[var(--color-background)] border border-[var(--color-border)] rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[var(--color-accent-primary)]"
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleCommit();
                }
              }}
            />
            <button
              onClick={handleCommit}
              disabled={!commitMessage.trim() || stagedFiles.length === 0 || actionLoading === 'commit'}
              className="mt-1.5 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--color-accent-primary)] text-white rounded hover:bg-[var(--color-accent-primary)]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading === 'commit' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Commit ({stagedFiles.length} staged)
            </button>
          </div>

          {/* Staged files */}
          {stagedFiles.length > 0 && (
            <FileSection
              title="Staged Changes"
              count={stagedFiles.length}
              expanded={expandedSections.staged}
              onToggle={() => toggleSection('staged')}
              files={stagedFiles}
              onAction={(f) => handleUnstage([f.path])}
              actionIcon={<Minus className="h-3 w-3" />}
              actionTitle="Unstage"
              statusBadgeColor={statusBadgeColor}
              onFileClick={handleViewDiff}
            />
          )}

          {/* Changed files */}
          {changedFiles.length > 0 && (
            <FileSection
              title="Changes"
              count={changedFiles.length}
              expanded={expandedSections.changes}
              onToggle={() => toggleSection('changes')}
              files={changedFiles}
              onAction={(f) => handleStage([f.path])}
              actionIcon={<Plus className="h-3 w-3" />}
              actionTitle="Stage"
              statusBadgeColor={statusBadgeColor}
              onFileClick={handleViewDiff}
            />
          )}

          {/* Untracked files */}
          {untrackedFiles.length > 0 && (
            <FileSection
              title="Untracked"
              count={untrackedFiles.length}
              expanded={expandedSections.untracked}
              onToggle={() => toggleSection('untracked')}
              files={untrackedFiles}
              onAction={(f) => handleStage([f.path])}
              actionIcon={<Plus className="h-3 w-3" />}
              actionTitle="Stage"
              statusBadgeColor={statusBadgeColor}
              onFileClick={handleViewDiff}
            />
          )}

          {/* Empty state */}
          {stagedFiles.length === 0 && changedFiles.length === 0 && untrackedFiles.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-[var(--color-text-muted)]">
              No changes detected
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {commits.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-[var(--color-text-muted)]">
              No commits yet
            </div>
          ) : (
            commits.map((commit) => (
              <div
                key={commit.hash}
                className="px-3 py-2 border-b border-[var(--color-border)] hover:bg-[var(--color-background)]/50 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-mono text-[var(--color-accent-primary)] flex-shrink-0 mt-0.5">
                    {commit.short_hash}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-[var(--color-text-primary)] truncate">{commit.message}</div>
                    <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                      {commit.author} - {new Date(commit.timestamp * 1000).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// --- File section sub-component ---

interface FileSectionProps {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  files: GitFile[];
  onAction: (file: GitFile) => void;
  actionIcon: React.ReactNode;
  actionTitle: string;
  statusBadgeColor: (changeType: string) => string;
  onFileClick: (file: GitFile) => void;
}

function FileSection({
  title,
  count,
  expanded,
  onToggle,
  files,
  onAction,
  actionIcon,
  actionTitle,
  statusBadgeColor,
  onFileClick,
}: FileSectionProps) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-1 w-full px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] uppercase tracking-wider transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
        <span className="ml-auto text-[10px] font-normal bg-[var(--color-bg-secondary)] px-1.5 rounded">
          {count}
        </span>
      </button>
      {expanded && (
        <div>
          {files.map((file) => {
            const fileName = file.path.split('/').pop() || file.path;
            const dirPath = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '';
            return (
              <div
                key={`${file.path}-${file.status}`}
                className="group flex items-center gap-1 px-3 py-1 hover:bg-[var(--color-background)]/50 transition-colors cursor-pointer"
                onClick={() => onFileClick(file)}
              >
                <span className={cn('text-[10px] font-mono w-4 text-center flex-shrink-0', statusBadgeColor(file.change_type))}>
                  {file.change_type}
                </span>
                <span className="text-xs text-[var(--color-text-primary)] truncate">{fileName}</span>
                {dirPath && (
                  <span className="text-[10px] text-[var(--color-text-muted)] truncate ml-1">{dirPath}</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onAction(file); }}
                  className="ml-auto p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] opacity-0 group-hover:opacity-100 transition-all"
                  title={actionTitle}
                >
                  {actionIcon}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
