import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { getWsUrl, resizeSession } from "../lib/api";
import { WsManager, type ConnectionState } from "../lib/websocket";

interface TerminalProps {
  sessionId: string;
  userEmail: string;
}

/**
 * xterm.js terminal connected to a Claude Code PTY session via WebSocket.
 *
 * - On mount: creates xterm instance, opens WebSocket, bridges I/O.
 * - On reconnect: the server replays the output buffer automatically.
 * - FitAddon handles responsive resizing; resize events are sent to the server.
 */
export default function Terminal({ sessionId, userEmail }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WsManager | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // ---- Status badge ----
  const statusRef = useRef<HTMLDivElement>(null);
  const setStatus = useCallback((state: ConnectionState) => {
    if (!statusRef.current) return;
    const colors: Record<ConnectionState, string> = {
      connecting: "bg-yellow-500",
      connected: "bg-green-500",
      disconnected: "bg-gray-500",
      error: "bg-red-500",
    };
    statusRef.current.className = `absolute top-2 right-2 w-2.5 h-2.5 rounded-full ${colors[state]}`;
    statusRef.current.title = state;
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    // ---- Create terminal ----
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, monospace',
      theme: {
        background: "#0F1F25",
        foreground: "#E8ECEF",
        cursor: "#FF3621",
        selectionBackground: "#2D455080",
        black: "#1B3139",
        red: "#FF3621",
        green: "#00C853",
        yellow: "#FFD600",
        blue: "#448AFF",
        magenta: "#E040FB",
        cyan: "#18FFFF",
        white: "#E8ECEF",
      },
      scrollback: 10000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    // ---- Connect WebSocket ----
    const wsUrl = getWsUrl(sessionId, userEmail);
    const wsManager = new WsManager({
      url: wsUrl,
      onData: (data) => {
        term.write(new Uint8Array(data));
      },
      onStateChange: setStatus,
    });
    wsManager.connect();
    wsRef.current = wsManager;

    // ---- Terminal → WebSocket ----
    const dataDisposable = term.onData((data) => {
      const encoder = new TextEncoder();
      wsManager.send(encoder.encode(data));
    });

    const binaryDisposable = term.onBinary((data) => {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        bytes[i] = data.charCodeAt(i);
      }
      wsManager.send(bytes);
    });

    // ---- Resize handling (debounce API call, keep fit immediate) ----
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit();
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const { rows, cols } = term;
          resizeSession(sessionId, rows, cols).catch(() => {});
        }, 300);
      });
    });
    resizeObserver.observe(containerRef.current);

    // ---- Cleanup ----
    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      dataDisposable.dispose();
      binaryDisposable.dispose();
      resizeObserver.disconnect();
      wsManager.dispose();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId, userEmail, setStatus]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div ref={statusRef} className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-gray-500" title="disconnected" />
    </div>
  );
}
