/**
 * API client for the Workshop backend.
 *
 * Handles backend discovery (hub routes to workers), session CRUD,
 * and WebSocket URL construction.
 */

export interface Session {
  session_id: string;
  user_email: string;
  session_name: string;
  workspace_dir: string;
  alive: boolean;
  idle_seconds: number;
  uptime_seconds: number;
  transcript_path: string | null;
}

export interface UserInfo {
  email: string;
}

// ---------------------------------------------------------------------------
// Backend URL resolution
// ---------------------------------------------------------------------------

/**
 * Return the base URL for API calls.
 *
 * In multi-instance mode the hub frontend sets VITE_BACKEND_URLS as a
 * comma-separated list.  We use consistent hashing on the user email to
 * pick one.  When running locally or as a single app, we fall back to
 * the same origin.
 */
function getBackendUrl(userEmail?: string): string {
  const raw = (import.meta as any).env?.VITE_BACKEND_URLS as string | undefined;
  if (!raw) return ""; // same origin

  const urls = raw.split(",").map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0) return "";
  if (urls.length === 1) return urls[0];

  // Consistent hash by email
  const email = userEmail ?? localStorage.getItem("workshop_email") ?? "";
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) | 0;
  }
  return urls[Math.abs(hash) % urls.length];
}

/**
 * Construct the WebSocket URL for a session.
 */
export function getWsUrl(sessionId: string, userEmail?: string): string {
  const base = getBackendUrl(userEmail);
  if (base) {
    const wsBase = base.replace(/^http/, "ws");
    return `${wsBase}/ws/session/${sessionId}`;
  }
  // Same origin — derive from current page
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/session/${sessionId}`;
}

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getBackendUrl();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export async function fetchMe(): Promise<UserInfo> {
  return apiFetch<UserInfo>("/api/me");
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function listSessions(): Promise<Session[]> {
  return apiFetch<Session[]>("/api/sessions");
}

export interface CreateSessionOpts {
  session_name: string;
  workspace_dir?: string;
  repo_url?: string;
  initial_prompt?: string;
}

export async function createSession(
  nameOrOpts: string | CreateSessionOpts
): Promise<Session> {
  const body =
    typeof nameOrOpts === "string"
      ? { session_name: nameOrOpts }
      : nameOrOpts;
  return apiFetch<Session>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function sendToSession(
  sessionId: string,
  text: string
): Promise<void> {
  await apiFetch(`/api/sessions/${sessionId}/send`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await apiFetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
}

export async function resizeSession(
  sessionId: string,
  rows: number,
  cols: number
): Promise<void> {
  await apiFetch(`/api/sessions/${sessionId}/resize`, {
    method: "POST",
    body: JSON.stringify({ rows, cols }),
  });
}
