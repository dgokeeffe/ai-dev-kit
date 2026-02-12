import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchMe,
  listSessions,
  createSession,
  deleteSession,
  getModel,
  setModel as setModelApi,
  type Session,
  type CreateSessionOpts,
} from "../lib/api";
import Terminal from "../components/Terminal";
import SessionCard from "../components/SessionCard";
import CreateSessionModal from "../components/CreateSessionModal";
import SetupScreen from "../components/SetupScreen";

/**
 * Workshop mode: shows setup screen on first visit for repo URLs.
 * Personal mode (MODE=personal env var): no setup screen.
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
  const [model, setModel] = useState("databricks-claude-sonnet-4-5");

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

    getModel().then(setModel).catch(() => {});

    refresh().finally(() => setLoading(false));

    // Poll for session status updates
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [navigate, refresh]);

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

  const handleModelChange = async (newModel: string) => {
    setModel(newModel);
    try {
      await setModelApi(newModel);
    } catch {
      // Revert on failure
      setModel(model);
    }
  };

  const handleCreate = async (opts: CreateSessionOpts) => {
    const s = await createSession({ ...opts, model });
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

  // First visit in workshop mode: show setup screen
  if (WORKSHOP_MODE && sessions.length === 0) {
    return <SetupScreen sessionTypes={DEFAULT_SESSIONS} onComplete={refresh} />;
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
          <select
            value={model}
            onChange={(e) => handleModelChange(e.target.value)}
            className="px-2 py-1 text-xs bg-databricks-darker border border-databricks-slate rounded text-white focus:outline-none focus:border-databricks-red cursor-pointer"
          >
            <option value="databricks-claude-sonnet-4-5">Sonnet 4.5</option>
            <option value="databricks-claude-opus-4-6">Opus 4.6</option>
          </select>
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
            <div className="h-full flex flex-col items-center justify-center text-gray-600">
              Select a session to begin
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
