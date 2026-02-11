/**
 * WebSocket connection manager with automatic reconnection.
 *
 * Wraps a single WebSocket connection to a Claude Code PTY session,
 * providing:
 *   - Automatic reconnection with exponential backoff
 *   - Connection state tracking
 *   - Clean teardown
 */

export type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

export interface WsManagerOptions {
  url: string;
  onData: (data: ArrayBuffer) => void;
  onStateChange: (state: ConnectionState) => void;
  maxReconnectAttempts?: number;
}

export class WsManager {
  private ws: WebSocket | null = null;
  private url: string;
  private onData: (data: ArrayBuffer) => void;
  private onStateChange: (state: ConnectionState) => void;
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _disposed = false;

  constructor(opts: WsManagerOptions) {
    this.url = opts.url;
    this.onData = opts.onData;
    this.onStateChange = opts.onStateChange;
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? 10;
  }

  connect(): void {
    if (this._disposed) return;
    this.onStateChange("connecting");

    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.onStateChange("connected");
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.onData(event.data);
      } else if (typeof event.data === "string") {
        // Convert string to ArrayBuffer for xterm
        const encoder = new TextEncoder();
        this.onData(encoder.encode(event.data).buffer);
      }
    };

    ws.onclose = () => {
      if (this._disposed) return;
      this.onStateChange("disconnected");
      this._scheduleReconnect();
    };

    ws.onerror = () => {
      if (this._disposed) return;
      this.onStateChange("error");
    };

    this.ws = ws;
  }

  send(data: string | ArrayBuffer | Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  dispose(): void {
    this._disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private _scheduleReconnect(): void {
    if (this._disposed) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.onStateChange("error");
      return;
    }
    // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
