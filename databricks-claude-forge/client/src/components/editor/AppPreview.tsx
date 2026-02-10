import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Globe, RefreshCw, Play, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getDeployStatus } from '@/lib/api';
import { toast } from 'sonner';

interface AppPreviewProps {
  projectId: string;
  className?: string;
}

type PreviewMode = 'deployed' | 'local';

export function AppPreview({ projectId, className = '' }: AppPreviewProps) {
  const [url, setUrl] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [iframeKey, setIframeKey] = useState(0);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('deployed');
  const [isLocalRunning, setIsLocalRunning] = useState(false);
  const [localPort, setLocalPort] = useState<number | null>(null);

  // Fetch deployed app URL
  useEffect(() => {
    const fetchUrl = async () => {
      try {
        const status = await getDeployStatus(projectId);
        if (status.app_url) {
          if (previewMode === 'deployed') {
            setUrl(status.app_url);
            setInputUrl(status.app_url);
          }
        }
      } catch {
        // No deploy status available
      }
    };
    fetchUrl();
  }, [projectId, previewMode]);

  // Check preview server status (reduced polling from 5s to 15s for performance)
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/preview/status`);
        const data = await res.json();
        if (data.status === 'running') {
          setIsLocalRunning(true);
          setLocalPort(data.port);
          if (previewMode === 'local') {
            const localUrl = `/api/projects/${projectId}/preview/`;
            setUrl(localUrl);
            setInputUrl(localUrl);
          }
        } else {
          setIsLocalRunning(false);
          setLocalPort(null);
        }
      } catch {
        setIsLocalRunning(false);
        setLocalPort(null);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 15000); // Reduced from 5s to 15s

    // Pause polling when tab is not visible
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearInterval(interval);
      } else {
        checkStatus();
        const newInterval = setInterval(checkStatus, 15000);
        return () => clearInterval(newInterval);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [projectId, previewMode]);

  const handleNavigate = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (inputUrl.trim()) {
      setUrl(inputUrl.trim());
    }
  }, [inputUrl]);

  const handleRefresh = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  const handleOpenExternal = useCallback(() => {
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [url]);

  const handleStartLocal = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/preview/start`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.status === 'started' || data.status === 'already_running') {
        setIsLocalRunning(true);
        setLocalPort(data.port);
        setPreviewMode('local');
        const localUrl = `/api/projects/${projectId}/preview/`;
        setUrl(localUrl);
        setInputUrl(localUrl);
        setIframeKey((k) => k + 1);
        toast.success(`Preview server started on port ${data.port}`);
      }
    } catch (error) {
      console.error('Failed to start preview server:', error);
      toast.error('Failed to start preview server');
    }
  }, [projectId]);

  const handleStopLocal = useCallback(async () => {
    try {
      await fetch(`/api/projects/${projectId}/preview/stop`, {
        method: 'POST',
      });
      setIsLocalRunning(false);
      setLocalPort(null);
      setUrl('');
      setInputUrl('');
      toast.success('Preview server stopped');
    } catch (error) {
      console.error('Failed to stop preview server:', error);
      toast.error('Failed to stop preview server');
    }
  }, [projectId]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Control bar */}
      <div className="flex items-center gap-2 h-8 px-2 bg-[var(--color-bg-secondary)]/50 border-b border-[var(--color-border)] flex-shrink-0">
        {/* Preview mode toggle */}
        <div className="flex items-center gap-1 border border-[var(--color-border)] rounded overflow-hidden">
          <button
            onClick={() => setPreviewMode('local')}
            className={cn(
              'px-2 py-0.5 text-xs transition-colors',
              previewMode === 'local'
                ? 'bg-[var(--color-accent-primary)] text-white'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)]'
            )}
          >
            Local
          </button>
          <button
            onClick={() => setPreviewMode('deployed')}
            className={cn(
              'px-2 py-0.5 text-xs transition-colors',
              previewMode === 'deployed'
                ? 'bg-[var(--color-accent-primary)] text-white'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)]'
            )}
          >
            Deployed
          </button>
        </div>

        {/* Local server controls */}
        {previewMode === 'local' && (
          <>
            {isLocalRunning ? (
              <>
                <button
                  onClick={handleStopLocal}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"
                >
                  <Square className="h-3 w-3" />
                  Stop
                </button>
                <span className="text-xs text-[var(--color-text-muted)]">
                  Port {localPort}
                </span>
              </>
            ) : (
              <button
                onClick={handleStartLocal}
                className="flex items-center gap-1 px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 transition-colors"
              >
                <Play className="h-3 w-3" />
                Start Server
              </button>
            )}
          </>
        )}

        <button
          onClick={handleRefresh}
          className="p-1 rounded hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors ml-auto"
          title="Refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
        <button
          onClick={handleOpenExternal}
          disabled={!url}
          className="p-1 rounded hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-30"
          title="Open in new tab"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>

      {/* URL bar */}
      {url && (
        <div className="flex items-center gap-1.5 h-6 px-2 bg-[var(--color-background)]/50 border-b border-[var(--color-border)] flex-shrink-0">
          <Globe className="h-3 w-3 text-[var(--color-text-muted)]" />
          <form onSubmit={handleNavigate} className="flex-1 flex">
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="Enter URL..."
              className="flex-1 h-4 px-2 text-xs bg-transparent border-none text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none"
            />
          </form>
        </div>
      )}

      {/* Content */}
      {url ? (
        <iframe
          key={iframeKey}
          src={url}
          className="flex-1 w-full border-none bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          title="App preview"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-[var(--color-background)]">
          <div className="text-center">
            <Globe className="h-8 w-8 mx-auto text-[var(--color-text-muted)] opacity-50" />
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              No app running. Deploy your app first or enter a URL above.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
