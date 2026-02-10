import { useCallback, useEffect, useRef, useState } from 'react';
import { Github, Loader2, X, ExternalLink, Copy, Check, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  startGitHubDeviceFlow,
  pollGitHubDeviceFlow,
  getGitHubStatus,
  disconnectGitHub,
  type DeviceFlowResponse,
  type GitHubStatus,
} from '@/lib/api';

interface GitHubConnectProps {
  className?: string;
}

type FlowState = 'idle' | 'loading' | 'waiting' | 'success' | 'error';

export function GitHubConnect({ className = '' }: GitHubConnectProps) {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check initial status
  useEffect(() => {
    getGitHubStatus()
      .then(setStatus)
      .catch(() => setStatus({ connected: false }));
  }, []);

  const startFlow = useCallback(async () => {
    setFlowState('loading');
    setError(null);
    try {
      const flow = await startGitHubDeviceFlow();
      setDeviceFlow(flow);
      setFlowState('waiting');

      // Start polling
      pollRef.current = setInterval(async () => {
        try {
          const result = await pollGitHubDeviceFlow(flow.device_code);
          if (result.status === 'success') {
            if (pollRef.current) clearInterval(pollRef.current);
            setStatus({ connected: true, username: result.username });
            setFlowState('success');
            setDeviceFlow(null);
          } else if (result.status === 'error') {
            if (pollRef.current) clearInterval(pollRef.current);
            setError(result.error || 'Authorization failed');
            setFlowState('error');
          }
        } catch (e) {
          // Ignore poll errors, keep trying
        }
      }, (flow.interval + 1) * 1000);

      // Stop polling after expiry
      setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          if (flowState === 'waiting') {
            setError('Authorization expired. Please try again.');
            setFlowState('error');
          }
        }
      }, flow.expires_in * 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start authorization');
      setFlowState('error');
    }
  }, [flowState]);

  const cancelFlow = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setDeviceFlow(null);
    setFlowState('idle');
    setError(null);
  }, []);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnectGitHub();
      setStatus({ connected: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect');
    }
  }, []);

  const copyCode = useCallback(() => {
    if (deviceFlow?.user_code) {
      navigator.clipboard.writeText(deviceFlow.user_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [deviceFlow]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Connected state
  if (status?.connected) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <div className="flex items-center gap-1.5 text-xs text-green-400">
          <Github className="h-3.5 w-3.5" />
          <span className="truncate max-w-[100px]">{status.username}</span>
        </div>
        <button
          onClick={handleDisconnect}
          className="p-1 text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
          title="Disconnect GitHub"
        >
          <LogOut className="h-3 w-3" />
        </button>
      </div>
    );
  }

  // Device flow in progress
  if (flowState === 'waiting' && deviceFlow) {
    return (
      <div className={cn('flex flex-col gap-2 p-2 bg-[var(--color-bg-secondary)] rounded border border-[var(--color-border)]', className)}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--color-text-primary)]">
            Connect GitHub
          </span>
          <button
            onClick={cancelFlow}
            className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="text-[10px] text-[var(--color-text-muted)]">
          Enter this code at github.com/login/device:
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-2 py-1 bg-[var(--color-background)] rounded text-sm font-mono text-[var(--color-accent-primary)] text-center tracking-widest">
            {deviceFlow.user_code}
          </code>
          <button
            onClick={copyCode}
            className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] bg-[var(--color-background)] rounded"
            title="Copy code"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
        <a
          href={deviceFlow.verification_uri}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-[var(--color-accent-primary)] text-white rounded hover:bg-[var(--color-accent-primary)]/80 transition-colors"
        >
          Open GitHub
          <ExternalLink className="h-3 w-3" />
        </a>
        <div className="flex items-center justify-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
          <Loader2 className="h-3 w-3 animate-spin" />
          Waiting for authorization...
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <span className="text-xs text-red-400 truncate">{error}</span>
        <button
          onClick={() => { setError(null); setFlowState('idle'); }}
          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] underline"
        >
          Retry
        </button>
      </div>
    );
  }

  // Idle state - show connect button
  return (
    <button
      onClick={startFlow}
      disabled={flowState === 'loading'}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors',
        'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)]',
        'disabled:opacity-50',
        className
      )}
      title="Connect GitHub for push/pull"
    >
      {flowState === 'loading' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Github className="h-3.5 w-3.5" />
      )}
      <span>Connect GitHub</span>
    </button>
  );
}
