import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { UserProvider } from "./contexts/UserContext";
import { ProjectsProvider } from "./contexts/ProjectsContext";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Lazy load pages for code splitting
const HomePage = lazy(() => import("./pages/HomePage"));
const ProjectPage = lazy(() => import("./pages/ProjectPage"));
const DocPage = lazy(() => import("./pages/DocPage"));

function App() {
  return (
    <ErrorBoundary>
      <UserProvider>
        <ProjectsProvider>
          <div className="min-h-screen bg-background">
            <Suspense fallback={
              <div className="flex items-center justify-center min-h-screen">
                <div className="text-muted-foreground">Loading...</div>
              </div>
            }>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/doc" element={<DocPage />} />
                <Route path="/projects/:projectId" element={<ProjectPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
            <Toaster position="bottom-right" />
          </div>
        </ProjectsProvider>
      </UserProvider>
    </ErrorBoundary>
  );
}

export default App;
