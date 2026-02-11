import { useState } from "react";

interface CreateSessionModalProps {
  onClose: () => void;
  onCreate: (opts: {
    session_name: string;
    workspace_dir?: string;
    repo_url?: string;
    initial_prompt?: string;
  }) => Promise<void>;
}

const PRESETS = [
  { value: "pipeline", label: "Data Pipeline" },
  { value: "app-analytics", label: "Analytics App" },
  { value: "app-ai", label: "AI App" },
  { value: "custom", label: "Custom..." },
];

export default function CreateSessionModal({
  onClose,
  onCreate,
}: CreateSessionModalProps) {
  const [selected, setSelected] = useState("custom");
  const [customName, setCustomName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [workspaceDir, setWorkspaceDir] = useState("");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const name = selected === "custom" ? customName.trim() : selected;
    if (!name) return;
    setCreating(true);
    try {
      await onCreate({
        session_name: name,
        repo_url: repoUrl.trim() || undefined,
        workspace_dir: workspaceDir.trim() || undefined,
        initial_prompt: initialPrompt.trim() || undefined,
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-databricks-dark rounded-xl border border-databricks-slate p-6 w-full max-w-lg shadow-2xl">
        <h2 className="text-lg font-semibold text-white mb-4">
          New Claude Code Session
        </h2>

        {/* Session type */}
        <div className="space-y-2 mb-4">
          {PRESETS.map((p) => (
            <label
              key={p.value}
              className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                selected === p.value
                  ? "bg-databricks-slate/50 border border-databricks-red/50"
                  : "border border-transparent hover:bg-databricks-slate/30"
              }`}
            >
              <input
                type="radio"
                name="session-type"
                value={p.value}
                checked={selected === p.value}
                onChange={() => setSelected(p.value)}
                className="accent-databricks-red"
              />
              <span className="text-sm text-white">{p.label}</span>
            </label>
          ))}
        </div>

        {selected === "custom" && (
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Session name (e.g. refactor-auth)"
            className="w-full px-3 py-2 mb-3 bg-databricks-darker border border-databricks-slate rounded-md text-white text-sm placeholder-gray-500 focus:outline-none focus:border-databricks-red"
          />
        )}

        {/* Git repository URL (optional) */}
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">
            Git repository URL{" "}
            <span className="text-gray-600">(optional - clones into session workspace)</span>
          </label>
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => {
              setRepoUrl(e.target.value);
              if (e.target.value.trim()) setWorkspaceDir("");
            }}
            placeholder="https://github.com/you/my-app"
            disabled={!!workspaceDir.trim()}
            className="w-full px-3 py-2 bg-databricks-darker border border-databricks-slate rounded-md text-white text-sm placeholder-gray-600 focus:outline-none focus:border-databricks-red font-mono disabled:opacity-40 disabled:cursor-not-allowed"
          />
        </div>

        {/* Workspace directory (optional) */}
        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">
            Workspace directory{" "}
            <span className="text-gray-600">(optional - use an existing local repo)</span>
          </label>
          <input
            type="text"
            value={workspaceDir}
            onChange={(e) => {
              setWorkspaceDir(e.target.value);
              if (e.target.value.trim()) setRepoUrl("");
            }}
            placeholder="/Users/you/Repos/my-project"
            disabled={!!repoUrl.trim()}
            className="w-full px-3 py-2 bg-databricks-darker border border-databricks-slate rounded-md text-white text-sm placeholder-gray-600 focus:outline-none focus:border-databricks-red font-mono disabled:opacity-40 disabled:cursor-not-allowed"
          />
        </div>

        {/* Initial prompt (optional) */}
        <div className="mb-4">
          <label className="block text-xs text-gray-400 mb-1">
            Initial prompt{" "}
            <span className="text-gray-600">(fire-and-forget — runs after startup)</span>
          </label>
          <textarea
            value={initialPrompt}
            onChange={(e) => setInitialPrompt(e.target.value)}
            placeholder="Build a Streamlit app that shows a chart of DBU consumption from system.billing.usage..."
            rows={3}
            className="w-full px-3 py-2 bg-databricks-darker border border-databricks-slate rounded-md text-white text-sm placeholder-gray-600 focus:outline-none focus:border-databricks-red resize-y"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || (selected === "custom" && !customName.trim())}
            className="px-4 py-2 text-sm bg-databricks-red hover:bg-red-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-md transition-colors"
          >
            {creating ? "Creating..." : "Create Session"}
          </button>
        </div>
      </div>
    </div>
  );
}
