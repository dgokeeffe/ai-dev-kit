import type { Session } from "../lib/api";

interface SessionCardProps {
  session: Session;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}

/** Tab-style session selector shown in the tab bar. */
export default function SessionCard({
  session,
  active,
  onClick,
  onDelete,
}: SessionCardProps) {
  const alive = session.alive;

  return (
    <button
      onClick={onClick}
      className={`
        group flex items-center gap-2 px-3 py-1.5 rounded-t-md text-sm
        transition-colors whitespace-nowrap
        ${
          active
            ? "bg-black text-white border-t border-x border-databricks-slate"
            : "bg-transparent text-gray-400 hover:text-white hover:bg-databricks-dark"
        }
      `}
    >
      {/* Status dot — pulses while alive */}
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          alive ? "bg-green-500 animate-pulse" : "bg-gray-600"
        }`}
      />

      {/* Session name */}
      <span className="font-medium">{session.session_name}</span>

      {/* Uptime badge */}
      {alive && session.uptime_seconds > 60 && (
        <span className="text-[10px] text-gray-600 font-mono">
          {session.uptime_seconds < 3600
            ? `${Math.floor(session.uptime_seconds / 60)}m`
            : `${Math.floor(session.uptime_seconds / 3600)}h`}
        </span>
      )}

      {/* Close button */}
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.stopPropagation();
            onDelete();
          }
        }}
        className="ml-1 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity"
        title="Stop session"
      >
        &times;
      </span>
    </button>
  );
}
