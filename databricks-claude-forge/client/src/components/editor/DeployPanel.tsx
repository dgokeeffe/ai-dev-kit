import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, Play, RefreshCw, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { deployProject, getDeployStatus, streamDeployLogs } from '@/lib/api';
import type { DeployLog, DeployStatus } from '@/lib/types';
import { Button } from '@/components/ui/Button';

interface DeployPanelProps {
  projectId: string;
  className?: string;
}

export function DeployPanel({ projectId, className = '' }: DeployPanelProps) {
  const [status, setStatus] = useState<DeployStatus>({
    status: 'idle',
  });
  const [logs, setLogs] = useState<DeployLog[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  // Fetch initial status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const data = await getDeployStatus(projectId);
        setStatus(data);
      } catch (error) {
        console.error('Failed to fetch deploy status:', error);
      }
    };
    fetchStatus();
  }, [projectId]);

  // Stream logs when deploying
  useEffect(() => {
    if (status.status !== 'deploying') return;

    const abortController = new AbortController();
    
    const streamLogs = async () => {
      try {
        await streamDeployLogs(
          projectId,
          (log) => {
            setLogs((prev) => [...prev, log]);
          },
          abortController.signal
        );
        // Refresh status when streaming ends
        const data = await getDeployStatus(projectId);
        setStatus(data);
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Failed to stream deploy logs:', error);
        }
      }
    };

    streamLogs();

    return () => {
      abortController.abort();
    };
  }, [projectId, status.status]);

  const handleDeploy = useCallback(async () => {
    try {
      setLogs([]);
      setIsExpanded(true);
      await deployProject(projectId);
      setStatus({ status: 'deploying' });
    } catch (error) {
      console.error('Failed to deploy:', error);
      setStatus({
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, [projectId]);

  const handleRefreshStatus = useCallback(async () => {
    try {
      const data = await getDeployStatus(projectId);
      setStatus(data);
    } catch (error) {
      console.error('Failed to fetch deploy status:', error);
    }
  }, [projectId]);

  const getStatusColor = () => {
    switch (status.status) {
      case 'deploying':
        return 'text-yellow-500';
      case 'success':
        return 'text-green-500';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-[var(--color-text-muted)]';
    }
  };

  const getStatusIcon = () => {
    switch (status.status) {
      case 'deploying':
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'success':
        return <span className="w-2 h-2 rounded-full bg-green-500" />;
      case 'error':
        return <XCircle className="h-4 w-4" />;
      default:
        return <span className="w-2 h-2 rounded-full bg-gray-500" />;
    }
  };

  return (
    <div className={cn('border-t border-[var(--color-border)]', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-bg-secondary)]/50">
        <div className="flex items-center gap-2">
          <Button
            onClick={handleDeploy}
            disabled={status.status === 'deploying'}
            className="h-7 px-2 text-xs"
          >
            {status.status === 'deploying' ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Deploying...
              </>
            ) : (
              <>
                <Play className="h-3 w-3 mr-1" />
                Deploy
              </>
            )}
          </Button>

          {/* Status indicator */}
          <div className={cn('flex items-center gap-1.5 text-xs', getStatusColor())}>
            {getStatusIcon()}
            <span className="capitalize">{status.status}</span>
          </div>

          {/* App URL */}
          {status.app_url && (
            <a
              href={status.app_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-[var(--color-accent-primary)] hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open App
            </a>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleRefreshStatus}
            className="p-1 rounded hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            title="Refresh status"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="px-2 py-0.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            {isExpanded ? 'Hide Logs' : 'Show Logs'}
          </button>
        </div>
      </div>

      {/* Logs panel */}
      {isExpanded && (
        <div className="h-32 overflow-y-auto bg-[var(--color-background)] p-2 font-mono text-xs">
          {logs.length === 0 ? (
            <div className="text-[var(--color-text-muted)]">
              {status.status === 'deploying' ? 'Waiting for logs...' : 'No deployment logs'}
            </div>
          ) : (
            logs.map((log, index) => (
              <div
                key={index}
                className={cn(
                  'py-0.5',
                  log.level === 'error' && 'text-red-400',
                  log.level === 'warning' && 'text-yellow-400',
                  log.level === 'info' && 'text-[var(--color-text-primary)]'
                )}
              >
                <span className="text-[var(--color-text-muted)]">
                  [{new Date(log.timestamp).toLocaleTimeString()}]
                </span>{' '}
                {log.message}
              </div>
            ))
          )}
        </div>
      )}

      {/* Error message */}
      {status.error && (
        <div className="px-3 py-2 bg-red-500/10 text-red-400 text-xs">
          Error: {status.error}
        </div>
      )}
    </div>
  );
}
