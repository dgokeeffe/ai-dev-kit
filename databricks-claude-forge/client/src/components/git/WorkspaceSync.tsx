import { useCallback, useState } from 'react';
import { Cloud, Loader2, Check, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { syncToWorkspace } from '@/lib/api';

interface WorkspaceSyncProps {
  projectId: string;
  className?: string;
}

type SyncState = 'idle' | 'syncing' | 'success' | 'error';

export function WorkspaceSync({ projectId, className = '' }: WorkspaceSyncProps) {
  const [state, setState] = useState<SyncState>('idle');
  const [lastPath, setLastPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSync = useCallback(async () => {
    setState('syncing');
    setError(null);
    try {
      const result = await syncToWorkspace(projectId);
      setLastPath(result.workspace_path);
      setState('success');
      // Reset to idle after 3 seconds
      setTimeout(() => setState('idle'), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
      setState('error');
    }
  }, [projectId]);

  const dismissError = useCallback(() => {
    setError(null);
    setState('idle');
  }, []);

  // Error state
  if (state === 'error' && error) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <AlertCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />
        <span className="text-xs text-red-400 truncate max-w-[150px]">{error}</span>
        <button
          onClick={dismissError}
          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] underline flex-shrink-0"
        >
          Dismiss
        </button>
      </div>
    );
  }

  // Success state
  if (state === 'success' && lastPath) {
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        <Check className="h-3.5 w-3.5 text-green-400" />
        <span className="text-xs text-green-400 truncate max-w-[180px]" title={lastPath}>
          Synced to Workspace
        </span>
      </div>
    );
  }

  // Idle/Syncing state
  return (
    <button
      onClick={handleSync}
      disabled={state === 'syncing'}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors',
        'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
      title="Sync project files to Databricks Workspace"
    >
      {state === 'syncing' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Cloud className="h-3.5 w-3.5" />
      )}
      <span>{state === 'syncing' ? 'Syncing...' : 'Sync to Workspace'}</span>
    </button>
  );
}
