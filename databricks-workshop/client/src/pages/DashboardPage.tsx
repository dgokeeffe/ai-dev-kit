import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchMe,
  listSessions,
  createSession,
  deleteSession,
  type Session,
  type CreateSessionOpts,
} from "../lib/api";
import Terminal from "../components/Terminal";
import SessionCard from "../components/SessionCard";
import CreateSessionModal from "../components/CreateSessionModal";

/**
 * Workshop mode: auto-creates these sessions on first visit.
 * Personal mode (MODE=personal env var): no auto-create.
 */
const WORKSHOP_MODE =
  !(import.meta as any).env?.VITE_MODE ||
  (import.meta as any).env?.VITE_MODE === "workshop";

const DEFAULT_SESSIONS = [
  { name: "pipeline", label: "Data Pipeline" },
  { name: "app-analytics", label: "Analytics App" },
  { name: "app-ai", label: "AI App" },
];

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string>("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const autoCreatedRef = useRef(false);

  // ---- Load user + sessions ----
  const refresh = useCallback(async () => {
    try {
      const s = await listSessions();
      setSessions(s);
    } catch {
      // Ignore — will retry on next poll
    }
  }, []);

  useEffect(() => {
    fetchMe()
      .then((u) => {
        setEmail(u.email);
        localStorage.setItem("workshop_email", u.email);
      })
      .catch(() => navigate("/"));

    refresh().finally(() => setLoading(false));

    // Poll for session status updates
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [navigate, refresh]);

  // ---- Auto-create default sessions (workshop mode only) ----
  useEffect(() => {
    if (!WORKSHOP_MODE) return;
    if (loading || sessions.length > 0 || autoCreatedRef.current) return;

    // Guard against StrictMode double-fire
    autoCreatedRef.current = true;

    (async () => {
      for (const { name } of DEFAULT_SESSIONS) {
        try {
          await createSession(name);
        } catch {
          break;
        }
      }
      await refresh();
    })();
  }, [loading, sessions.length, refresh]);

  // ---- Select first session by default ----
  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].session_id);
    }
  }, [sessions, activeSessionId]);

  // ---- Handlers ----
  const handleDelete = async (sid: string) => {
    await deleteSession(sid);
    if (activeSessionId === sid) setActiveSessionId(null);
    await refresh();
  };

  const handleCreate = async (opts: CreateSessionOpts) => {
    const s = await createSession(opts);
    setShowCreate(false);
    setActiveSessionId(s.session_id);
    await refresh();
  };

  const activeSession = sessions.find((s) => s.session_id === activeSessionId);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        Loading sessions...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-databricks-dark border-b border-databricks-slate">
        <div className="flex items-center gap-3">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#FF3621" />
            <path
              d="M8 16h5l3-8 4 16 3-8h5"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-semibold text-white">
            {WORKSHOP_MODE ? "Vibe Workshop" : "Claude Sessions"}
          </span>
          <span className="text-sm text-gray-500">{email}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">
            {sessions.filter((s) => s.alive).length} active
          </span>
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 text-sm bg-databricks-red hover:bg-red-600 text-white rounded-md transition-colors"
          >
            + New Session
          </button>
        </div>
      </header>

      {/* Main content: session tabs + terminal */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Session tabs */}
        <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1 bg-databricks-darker border-b border-databricks-slate overflow-x-auto">
          {sessions.map((s) => (
            <SessionCard
              key={s.session_id}
              session={s}
              active={s.session_id === activeSessionId}
              onClick={() => setActiveSessionId(s.session_id)}
              onDelete={() => handleDelete(s.session_id)}
            />
          ))}
        </div>

        {/* Terminal area */}
        <div className="flex-1 min-h-0 bg-black relative">
          {activeSession ? (
            <>
              <Terminal
                key={activeSession.session_id}
                sessionId={activeSession.session_id}
                userEmail={email}
              />
              {/* Session info overlay */}
              <div className="absolute top-2 right-2 text-xs text-gray-600 bg-black/80 px-2 py-1 rounded pointer-events-none">
                {activeSession.alive ? (
                  <span className="text-green-600">
                    running {formatUptime(activeSession.uptime_seconds)}
                  </span>
                ) : (
                  <span className="text-red-500">stopped</span>
                )}
                {activeSession.workspace_dir && (
                  <span className="ml-2 text-gray-700 font-mono">
                    {activeSession.workspace_dir}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-gray-600 gap-4">
              {sessions.length === 0 ? (
                <>
                  <p>No sessions running.</p>
                  <button
                    onClick={() => setShowCreate(true)}
                    className="px-4 py-2 text-sm bg-databricks-red hover:bg-red-600 text-white rounded-md transition-colors"
                  >
                    Create your first session
                  </button>
                </>
              ) : (
                "Select a session to begin"
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateSessionModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
