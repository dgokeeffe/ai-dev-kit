import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { cn } from '@/lib/utils';
import { AlertCircle, RefreshCw, Loader2, Maximize2, Minimize2, Sparkles } from 'lucide-react';

const API_BASE = '/api';

interface ClaudeTerminalProps {
  projectId: string;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  suggestedPrompts?: string[];
  className?: string;
  onFilesChanged?: () => void;
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export function ClaudeTerminal({ projectId, isMaximized = false, onToggleMaximize, suggestedPrompts, className = '', onFilesChanged }: ClaudeTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failCountRef = useRef(0);
  const pollIntervalRef = useRef(100); // Start at 100ms
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [promptsDismissed, setPromptsDismissed] = useState(false);
  const isConnectingRef = useRef(false);
  const isReconnectingRef = useRef(false);
  const reconnectFnRef = useRef<(() => void) | null>(null);
  const lastMtimeRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current as unknown as ReturnType<typeof setTimeout>);
      pollingRef.current = null;
    }
  }, []);

  const sendResize = useCallback(async (sid: string) => {
    const terminal = xtermRef.current;
    if (!terminal) return;
    const { cols, rows } = terminal;

    try {
      const response = await fetch(`${API_BASE}/projects/${projectId}/pty/${sid}/resize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols, rows }),
      });

      if (!response.ok) {
        // Session likely lost - trigger reconnection
        console.warn('Resize failed, reconnecting terminal...');
        if (reconnectFnRef.current) {
          reconnectFnRef.current();
        }
      }
    } catch (error) {
      console.error('Resize error:', error);
      if (reconnectFnRef.current) {
        reconnectFnRef.current();
      }
    }
  }, [projectId]);

  const startPolling = useCallback((sid: string) => {
    stopPolling();
    pollIntervalRef.current = 100; // Reset to fast polling

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/projects/${projectId}/pty/${sid}/output`, {
          method: 'POST',
        });

        // Check for session loss (404 Not Found)
        if (res.status === 404) {
          console.warn('Session lost (404), reconnecting...');
          stopPolling();
          if (reconnectFnRef.current) {
            reconnectFnRef.current();
          }
          return;
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        failCountRef.current = 0;

        if (data.output) {
          // Got data - reset to fast polling
          pollIntervalRef.current = 100;
          const raw = atob(data.output);
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) {
            bytes[i] = raw.charCodeAt(i);
          }
          xtermRef.current?.write(bytes);
        } else {
          // No data - exponential backoff (max 2 seconds)
          pollIntervalRef.current = Math.min(pollIntervalRef.current * 1.5, 2000);
        }

        if (data.exited) {
          xtermRef.current?.writeln('\r\n\x1b[33m⚠ Process exited\x1b[0m');
          setConnectionState('disconnected');
          stopPolling();
        } else {
          // Schedule next poll with current interval
          pollingRef.current = setTimeout(poll, pollIntervalRef.current) as unknown as ReturnType<typeof setInterval>;
        }
      } catch {
        failCountRef.current++;
        if (failCountRef.current >= 5) {
          setConnectionState('error');
          setErrorMessage('Connection lost');
          stopPolling();
        } else {
          // Retry with current interval
          pollingRef.current = setTimeout(poll, pollIntervalRef.current) as unknown as ReturnType<typeof setInterval>;
        }
      }
    };

    // Start polling
    poll();
  }, [projectId, stopPolling]);

  // Create a PTY session
  const connect = useCallback(async () => {
    if (!xtermRef.current || isConnectingRef.current) return;
    isConnectingRef.current = true;
    setConnectionState('connecting');
    setErrorMessage(null);

    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/pty/create`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      sessionIdRef.current = data.session_id;
      setConnectionState('connected');

      xtermRef.current?.writeln(`\x1b[32m✓ Connected (session ${data.session_id.slice(0, 8)})\x1b[0m`);
      xtermRef.current?.writeln('');

      startPolling(data.session_id);

      // Send initial resize after a brief delay to let the terminal settle
      setTimeout(() => {
        if (fitAddonRef.current) {
          try { fitAddonRef.current.fit(); } catch { /* ignore */ }
        }
        sendResize(data.session_id);
      }, 100);
    } catch (err) {
      setConnectionState('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
      xtermRef.current?.writeln(`\x1b[31m✗ Error: ${err instanceof Error ? err.message : err}\x1b[0m`);
    } finally {
      isConnectingRef.current = false;
    }
  }, [projectId, startPolling, sendResize]);

  // Initialize xterm.js
  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(terminalRef.current);

    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    terminal.writeln('\x1b[1;34m╭─────────────────────────────────────────────────────╮\x1b[0m');
    terminal.writeln('\x1b[1;34m│\x1b[0m  \x1b[1;33mClaude Code Terminal\x1b[0m                               \x1b[1;34m│\x1b[0m');
    terminal.writeln('\x1b[1;34m│\x1b[0m  Connecting to Databricks-authenticated session...  \x1b[1;34m│\x1b[0m');
    terminal.writeln('\x1b[1;34m╰─────────────────────────────────────────────────────╯\x1b[0m');
    terminal.writeln('');

    // Send keystrokes to PTY via HTTP
    terminal.onData((data: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const encoded = btoa(data);
      fetch(`${API_BASE}/projects/${projectId}/pty/${sid}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: encoded }),
      }).catch(() => {});
    });

    return () => {
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Connect after terminal is ready
  useEffect(() => {
    const timer = setTimeout(() => {
      if (xtermRef.current) {
        connect();
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      stopPolling();
      const sid = sessionIdRef.current;
      if (sid) {
        fetch(`${API_BASE}/projects/${projectId}/pty/${sid}`, { method: 'DELETE' }).catch(() => {});
        sessionIdRef.current = null;
      }
    };
  }, [connect, stopPolling, projectId]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && xtermRef.current) {
        try {
          fitAddonRef.current.fit();
          const sid = sessionIdRef.current;
          if (sid) sendResize(sid);
        } catch { /* ignore */ }
      }
    };

    let resizeTimeout: ReturnType<typeof setTimeout>;
    const debouncedResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(handleResize, 250);  // Increased from 100ms to reduce excessive calls
    };

    window.addEventListener('resize', debouncedResize);

    const resizeObserver = new ResizeObserver(debouncedResize);
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      window.removeEventListener('resize', debouncedResize);
      resizeObserver.disconnect();
      clearTimeout(resizeTimeout);
    };
  }, [sendResize]);

  // Send a suggested prompt to the terminal input
  const sendPromptToTerminal = useCallback((prompt: string) => {
    setPromptsDismissed(true);
    const sid = sessionIdRef.current;
    if (!sid) return;
    // Encode and send each character to the PTY
    const encoded = btoa(prompt + '\n');
    fetch(`${API_BASE}/projects/${projectId}/pty/${sid}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: encoded }),
    }).catch(() => {});
  }, [projectId]);

  // Reconnect handler: preserve terminal history and automatically reconnect
  const handleReconnect = useCallback(() => {
    if (isReconnectingRef.current) return;
    isReconnectingRef.current = true;

    // Show reconnection message in terminal
    if (xtermRef.current) {
      xtermRef.current.write('\r\n\x1b[33mReconnecting session...\x1b[0m\r\n');
    }

    // Stop current polling
    stopPolling();

    // Clean up old session
    const oldSid = sessionIdRef.current;
    if (oldSid) {
      fetch(`${API_BASE}/projects/${projectId}/pty/${oldSid}`, { method: 'DELETE' }).catch(() => {});
      sessionIdRef.current = null;
    }

    // Reset connecting flag and create new session
    isConnectingRef.current = false;

    // Create new session (terminal history is preserved in xterm.js buffer)
    connect()
      .then(() => {
        isReconnectingRef.current = false;
      })
      .catch((error) => {
        console.error('Reconnection failed:', error);
        isReconnectingRef.current = false;
        setConnectionState('error');
      });
  }, [connect, projectId, stopPolling]);

  // Assign reconnect function to ref so it can be called from other callbacks
  reconnectFnRef.current = handleReconnect;

  return (
    <div className={cn('relative h-full w-full flex flex-col', className)}>
      {/* Status bar */}
      <div className="flex items-center justify-between h-8 px-3 bg-[#252526] border-b border-[#3c3c3c] flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#d4d4d4] font-medium">Claude Code</span>
          <span
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]',
              connectionState === 'connected' && 'bg-green-500/20 text-green-400',
              connectionState === 'connecting' && 'bg-blue-500/20 text-blue-400',
              connectionState === 'disconnected' && 'bg-yellow-500/20 text-yellow-400',
              connectionState === 'error' && 'bg-red-500/20 text-red-400'
            )}
          >
            {connectionState === 'connecting' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
            {connectionState === 'connected' && '●'}
            {connectionState === 'disconnected' && '○'}
            {connectionState === 'error' && <AlertCircle className="h-2.5 w-2.5" />}
            {connectionState}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {(connectionState === 'disconnected' || connectionState === 'error') && (
            <button
              onClick={handleReconnect}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-[#d4d4d4] hover:text-white hover:bg-[#3c3c3c] rounded transition-colors"
            >
              <RefreshCw className="h-2.5 w-2.5" />
              Reconnect
            </button>
          )}
          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              className="flex items-center justify-center p-1 text-[#d4d4d4] hover:text-white hover:bg-[#3c3c3c] rounded transition-colors"
              title={isMaximized ? 'Restore' : 'Maximize'}
            >
              {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-hidden"
        style={{ padding: '8px' }}
      />

      {/* Suggested prompts overlay */}
      {suggestedPrompts && suggestedPrompts.length > 0 && !promptsDismissed && connectionState === 'connected' && (
        <div className="absolute bottom-2 left-2 right-2 z-10">
          <div className="bg-[#252526]/95 border border-[#3c3c3c] rounded-lg p-3 backdrop-blur-sm">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles className="h-3 w-3 text-[#d4d4d4]" />
              <span className="text-[10px] text-[#808080] uppercase tracking-wide">Suggested prompts</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {suggestedPrompts.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => sendPromptToTerminal(prompt)}
                  className="text-left text-xs text-[#d4d4d4] hover:text-white bg-[#1e1e1e] hover:bg-[#2d2d2d] rounded px-2.5 py-1.5 transition-colors border border-[#3c3c3c] hover:border-[#505050]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {connectionState === 'error' && errorMessage && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
          <div className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4 max-w-md text-center">
            <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
            <h3 className="text-sm font-medium text-[#d4d4d4] mb-1">Connection Error</h3>
            <p className="text-xs text-[#808080] mb-3">{errorMessage}</p>
            <button
              onClick={handleReconnect}
              className="px-3 py-1.5 bg-[#0e639c] hover:bg-[#1177bb] text-white text-xs rounded transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
