import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMe } from "../lib/api";

const IS_PERSONAL =
  (import.meta as any).env?.VITE_MODE === "personal";

export default function LandingPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMe()
      .then((u) => {
        setEmail(u.email);
        localStorage.setItem("workshop_email", u.email);
        // Personal mode: skip the landing page entirely
        if (IS_PERSONAL) navigate("/dashboard");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [navigate]);

  const handleStart = () => {
    navigate("/dashboard");
  };

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-8">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="flex items-center justify-center gap-3 mb-4">
          <svg width="40" height="40" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#FF3621" />
            <path d="M8 16h5l3-8 4 16 3-8h5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1 className="text-4xl font-bold text-white">
            Vibe Coding Workshop
          </h1>
        </div>
        <p className="text-lg text-gray-400">
          Build a complete data platform on Databricks — powered by Claude Code
        </p>
      </div>

      {/* Challenge Card */}
      <div className="w-full max-w-2xl bg-databricks-dark rounded-xl border border-databricks-slate p-8 mb-8">
        <h2 className="text-xl font-semibold text-databricks-red mb-4">
          The Challenge
        </h2>
        <div className="space-y-4 text-gray-300">
          <div className="flex items-start gap-3">
            <span className="flex-shrink-0 w-8 h-8 bg-databricks-slate rounded-lg flex items-center justify-center text-sm font-bold text-databricks-red">
              1
            </span>
            <div>
              <p className="font-medium text-white">Data Pipeline</p>
              <p className="text-sm">
                Build a Lakeflow Declarative Pipeline (bronze &rarr; silver &rarr; gold)
                with synthetic data generation.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex-shrink-0 w-8 h-8 bg-databricks-slate rounded-lg flex items-center justify-center text-sm font-bold text-databricks-red">
              2
            </span>
            <div>
              <p className="font-medium text-white">Analytics App</p>
              <p className="text-sm">
                Create a Dash or Streamlit app that visualizes your pipeline
                output, deployed as a Databricks App.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="flex-shrink-0 w-8 h-8 bg-databricks-slate rounded-lg flex items-center justify-center text-sm font-bold text-databricks-red">
              3
            </span>
            <div>
              <p className="font-medium text-white">AI App</p>
              <p className="text-sm">
                Build an app using the Databricks Foundation Model API, deployed
                via git integration.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* User + Start */}
      <div className="w-full max-w-2xl text-center">
        {loading ? (
          <p className="text-gray-500">Authenticating...</p>
        ) : error ? (
          <p className="text-red-400">
            Authentication error: {error}
          </p>
        ) : (
          <>
            <p className="text-gray-400 mb-6">
              Signed in as{" "}
              <span className="text-white font-medium">{email}</span>
            </p>
            <button
              onClick={handleStart}
              className="px-8 py-3 bg-databricks-red hover:bg-red-600 text-white font-semibold rounded-lg transition-colors text-lg shadow-lg shadow-red-900/30"
            >
              Start Workshop
            </button>
          </>
        )}
      </div>

      {/* Footer hints */}
      <div className="mt-12 text-center text-sm text-gray-600">
        <p>
          You will get 3 concurrent Claude Code sessions — one for each
          challenge.
        </p>
        <p className="mt-1">
          Sessions persist even if you close the browser. Come back anytime.
        </p>
      </div>
    </div>
  );
}
