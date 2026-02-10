import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  File,
  Folder,
  GitBranch,
  Loader2,
  MessageSquare,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useProjects } from '@/contexts/ProjectsContext';
import { useUser } from '@/contexts/UserContext';
import { formatRelativeTime } from '@/lib/utils';
import { PROJECT_TEMPLATES, type ProjectTemplate } from '@/lib/templates';

const ICON_MAP: Record<string, typeof MessageSquare> = {
  MessageSquare,
  BarChart3,
  Wrench,
  GitBranch,
  File,
};

function TemplateCard({
  template,
  onSelect,
}: {
  template: ProjectTemplate;
  onSelect: (template: ProjectTemplate) => void;
}) {
  const Icon = ICON_MAP[template.icon] || File;

  return (
    <button
      onClick={() => onSelect(template)}
      className={`flex items-start gap-3 p-4 rounded-lg border-l-4 ${template.color} border border-[var(--color-border)]/50 bg-[var(--color-bg-secondary)] text-left transition-all duration-150 hover:border-[var(--color-border)] hover:shadow-md ${template.id === 'blank' ? 'opacity-70 hover:opacity-100' : ''}`}
    >
      <div className="flex-shrink-0 mt-0.5">
        <Icon className="h-5 w-5 text-[var(--color-text-muted)]" />
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-medium text-[var(--color-text-heading)]">
          {template.name}
        </h3>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)] line-clamp-2">
          {template.description}
        </p>
      </div>
    </button>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const { loading: userLoading, error: userError, retry: retryUser, branding, databaseAvailable } = useUser();
  const { projects, loading: projectsLoading, error: projectsError, refresh: retryProjects, createProject, deleteProject } = useProjects();
  const [selectedTemplate, setSelectedTemplate] = useState<ProjectTemplate | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    document.title = branding.app_title;
  }, [branding.app_title]);

  const handleSelectTemplate = (template: ProjectTemplate) => {
    setSelectedTemplate(template);
    setNewProjectName('');
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    setIsCreating(true);
    try {
      const templateId = selectedTemplate?.id === 'blank' ? undefined : selectedTemplate?.id;
      const project = await createProject(newProjectName.trim(), templateId);
      setNewProjectName('');
      setSelectedTemplate(null);
      toast.success('Project created');
      navigate(`/projects/${project.id}`);
    } catch (error) {
      toast.error('Failed to create project');
      console.error(error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (!confirm('Delete this project and all its conversations?')) return;

    try {
      await deleteProject(projectId);
      toast.success('Project deleted');
    } catch (error) {
      toast.error('Failed to delete project');
      console.error(error);
    }
  };

  if (userLoading || projectsLoading) {
    return (
      <MainLayout>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--color-text-muted)]" />
        </div>
      </MainLayout>
    );
  }

  if (userError) {
    return (
      <MainLayout>
        <div className="flex h-full items-center justify-center">
          <div className="text-center max-w-md">
            <AlertTriangle className="mx-auto h-10 w-10 text-[var(--color-error)]" />
            <h2 className="mt-4 text-lg font-semibold text-[var(--color-text-heading)]">
              Failed to connect
            </h2>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              {userError.message}
            </p>
            <Button className="mt-4" onClick={retryUser}>
              Retry
            </Button>
          </div>
        </div>
      </MainLayout>
    );
  }

  if (projectsError) {
    return (
      <MainLayout>
        <div className="flex h-full items-center justify-center">
          <div className="text-center max-w-md">
            <AlertTriangle className="mx-auto h-10 w-10 text-[var(--color-error)]" />
            <h2 className="mt-4 text-lg font-semibold text-[var(--color-text-heading)]">
              Failed to load projects
            </h2>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              {projectsError.message}
            </p>
            <Button className="mt-4" onClick={retryProjects}>
              Retry
            </Button>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="mx-auto max-w-4xl w-full px-4 py-8 flex flex-col flex-1 min-h-0">
          {/* Page header */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-[var(--color-text-heading)]">
              {branding.app_title}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Build with AI on Databricks
            </p>
          </div>

          {/* Database warning */}
          {!databaseAvailable && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 text-yellow-400 mt-0.5" />
              <div>
                <p className="font-medium">Database not connected</p>
                <p className="mt-0.5 text-yellow-200/70">
                  Projects and conversations will not be persisted across restarts.
                </p>
              </div>
            </div>
          )}

          {/* Create project section */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-[var(--color-text-heading)] mb-3">
              New project
            </h3>

            {selectedTemplate ? (
              /* Name input after template selection */
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-[var(--color-text-muted)]">
                    Template: {selectedTemplate.name}
                  </span>
                  <button
                    onClick={() => setSelectedTemplate(null)}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <form onSubmit={handleCreateProject} className="flex gap-3">
                  <Input
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="Project name..."
                    className="flex-1"
                    autoFocus
                  />
                  <Button type="submit" disabled={!newProjectName.trim() || isCreating}>
                    {isCreating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Create'
                    )}
                  </Button>
                </form>
              </div>
            ) : (
              /* Template grid */
              <div className="grid grid-cols-2 gap-3">
                {PROJECT_TEMPLATES.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onSelect={handleSelectTemplate}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Projects list */}
          {projects.length === 0 ? (
            <div className="text-center py-12 text-[var(--color-text-muted)]">
              <Folder className="mx-auto h-10 w-10 opacity-50" />
              <p className="mt-3 text-sm">
                No projects yet. Choose a template above to get started.
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto min-h-0">
              <h3 className="text-sm font-medium text-[var(--color-text-heading)] mb-3">
                Your projects
              </h3>
              <div className="grid gap-3 pb-4">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    onClick={() => navigate(`/projects/${project.id}`)}
                    className="group flex cursor-pointer items-center justify-between rounded-xl border border-[var(--color-border)]/50 bg-[var(--color-bg-secondary)] p-4 transition-all duration-200 hover:border-[var(--color-border)] hover:shadow-md"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-accent-primary)]/10">
                        <Folder className="h-6 w-6 text-[var(--color-accent-primary)]" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-[var(--color-text-heading)]">
                          {project.name}
                        </h3>
                        <div className="mt-1 flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
                          <span className="flex items-center gap-1">
                            <MessageSquare className="h-3.5 w-3.5" />
                            {project.conversations?.length || 0} conversation
                            {(project.conversations?.length || 0) !== 1 ? 's' : ''}
                          </span>
                          <span>{formatRelativeTime(project.created_at)}</span>
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => handleDeleteProject(e, project.id)}
                    >
                      <Trash2 className="h-4 w-4 text-[var(--color-error)]" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
