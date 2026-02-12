import { useState } from "react";
import { createSession, type CreateSessionOpts } from "../lib/api";

interface SessionType {
  name: string;
  label: string;
}

interface SetupScreenProps {
  sessionTypes: SessionType[];
  onComplete: () => void;
}

export default function SetupScreen({
  sessionTypes,
  onComplete,
}: SetupScreenProps) {
  const [repoUrls, setRepoUrls] = useState<Record<string, string>>(
    () => Object.fromEntries(sessionTypes.map((s) => [s.name, ""]))
  );
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    name: string;
  } | null>(null);
  const [error, setError] = useState<{
    sessionName: string;
    message: string;
  } | null>(null);

  const allFilled = sessionTypes.every(
    (s) => repoUrls[s.name]?.trim().length > 0
  );

  const handleSubmit = async () => {
    setCreating(true);
    setError(null);

    const total = sessionTypes.length;
    for (let i = 0; i < total; i++) {
      const { name, label } = sessionTypes[i];
      setProgress({ current: i + 1, total, name: label });

      const opts: CreateSessionOpts = {
        session_name: name,
        repo_url: repoUrls[name].trim(),
      };

      try {
        await createSession(opts);
      } catch (err: any) {
        setError({
          sessionName: label,
          message: err.message ?? "Failed to create session",
        });
        setCreating(false);
        setProgress(null);
        return;
      }
    }

    setCreating(false);
    setProgress(null);
    onComplete();
  };

  return (
    <div className="h-full flex items-center justify-center bg-databricks-darker">
      <div className="w-full max-w-2xl px-6">
        <div className="text-center mb-8">
          <svg
            width="40"
            height="40"
            viewBox="0 0 32 32"
            fill="none"
            className="mx-auto mb-4"
          >
            <rect width="32" height="32" rx="8" fill="#FF3621" />
            <path
              d="M8 16h5l3-8 4 16 3-8h5"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <h1 className="text-2xl font-semibold text-white mb-2">
            Vibe Workshop Setup
          </h1>
          <p className="text-gray-400 text-sm">
            Enter a Git repository URL for each session. Repos will be cloned
            into your workspace.
          </p>
        </div>

        <div className="space-y-4 mb-8">
          {sessionTypes.map((s) => (
            <div
              key={s.name}
              className="bg-databricks-dark border border-databricks-slate rounded-lg p-4"
            >
              <label className="block text-sm font-medium text-white mb-2">
                {s.label}
                <span className="ml-2 text-xs text-gray-500 font-normal font-mono">
                  {s.name}
                </span>
              </label>
              <input
                type="text"
                value={repoUrls[s.name]}
                onChange={(e) =>
                  setRepoUrls((prev) => ({
                    ...prev,
                    [s.name]: e.target.value,
                  }))
                }
                placeholder="https://github.com/you/my-repo"
                disabled={creating}
                className="w-full px-3 py-2 bg-databricks-darker border border-databricks-slate rounded-md text-white text-sm placeholder-gray-600 focus:outline-none focus:border-databricks-red font-mono disabled:opacity-40 disabled:cursor-not-allowed"
              />
              {error?.sessionName === s.label && (
                <p className="mt-2 text-sm text-red-400">{error.message}</p>
              )}
            </div>
          ))}
        </div>

        <div className="text-center">
          {progress ? (
            <p className="text-sm text-gray-400 mb-4">
              Creating session {progress.current} of {progress.total}
              <span className="text-white ml-1">({progress.name})</span>...
            </p>
          ) : null}
          <button
            onClick={handleSubmit}
            disabled={!allFilled || creating}
            className="px-6 py-2.5 text-sm font-medium bg-databricks-red hover:bg-red-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-md transition-colors"
          >
            {creating ? "Creating..." : "Start Workshop"}
          </button>
        </div>
      </div>
    </div>
  );
}
