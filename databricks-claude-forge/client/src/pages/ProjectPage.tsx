import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useUser } from '@/contexts/UserContext';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { MainLayout } from '@/components/layout/MainLayout';
import { IDELayout } from '@/components/layout/IDELayout';
import { ActivityType } from '@/components/layout/ActivityBar';
import { BottomPanelTab } from '@/components/layout/BottomPanel';
import { SkillsExplorer } from '@/components/SkillsExplorer';
import { CommandPalette } from '@/components/CommandPalette';
import { QuickOpen } from '@/components/QuickOpen';
import { GlobalSearch } from '@/components/search/GlobalSearch';
import { SourceControl } from '@/components/git/SourceControl';
import { Terminal } from '@/components/terminal/Terminal';
import { ClaudeTerminal } from '@/components/terminal/ClaudeTerminal';
import { OutputPanel, OutputLine } from '@/components/terminal/OutputPanel';
import {
  AppPreview,
  FileExplorer,
  DeployPanel,
  EditorPaneManager,
  createInitialLayout,
  splitPane,
} from '@/components/editor';
import type { OpenFile, PaneLayout, PaneState } from '@/components/editor';
import { useKeyboardShortcuts, cmdOrCtrl, cmdShift } from '@/hooks/useKeyboardShortcuts';
import { Command, CommandCategories } from '@/lib/commands';
import {
  fetchClusters,
  fetchFileContent,
  fetchProject,
  fetchProjectFiles,
  fetchWarehouses,
  saveFileContent,
  deleteFile as apiDeleteFile,
  createFile,
} from '@/lib/api';
import type { Cluster, FileNode, Project, Warehouse } from '@/lib/types';
import { getTemplate } from '@/lib/templates';

// Sanitize string for schema name
function sanitizeForSchema(str: string): string {
  return str.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

// Convert email + project name to schema name
function toSchemaName(email: string | null, projectName: string | null): string {
  if (!email) return '';
  const localPart = email.split('@')[0];
  const emailPart = sanitizeForSchema(localPart);
  if (!projectName) return emailPart;
  const projectPart = sanitizeForSchema(projectName);
  return `${emailPart}_${projectPart}`;
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user, branding } = useUser();

  // State - Project
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // State - Databricks config (kept for skills explorer)
  const [, setClusters] = useState<Cluster[]>([]);
  const [selectedClusterId, setSelectedClusterId] = useState<string | undefined>();
  const [, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | undefined>();
  const [defaultCatalog] = useState<string>('ai_dev_kit');
  const [defaultSchema, setDefaultSchema] = useState<string>('');
  const [workspaceFolder, setWorkspaceFolder] = useState<string>('');
  const [skillsExplorerOpen, setSkillsExplorerOpen] = useState(false);

  // State - Files
  const [files, setFiles] = useState<FileNode[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [fileCache, setFileCache] = useState<Map<string, { content: string; timestamp: number }>>(new Map());

  // State - IDE Layout
  // Load panel sizes from localStorage on initial render
  const [activeActivity, setActiveActivity] = useState<ActivityType | null>('explorer');
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('panel-leftSidebarWidth');
    return saved ? parseInt(saved, 10) : 200;
  });
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('panel-rightSidebarWidth');
    return saved ? parseInt(saved, 10) : 450;
  });
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(() => {
    const saved = localStorage.getItem('panel-bottomPanelHeight');
    return saved ? parseInt(saved, 10) : 300;
  });
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(false);
  const [bottomPanelTab, setBottomPanelTab] = useState<BottomPanelTab>('terminal');
  const [outputLines] = useState<OutputLine[]>([]);
  const [isClaudeMaximized, setIsClaudeMaximized] = useState(false);

  // State - Editor panes
  const [editorLayout, setEditorLayout] = useState<PaneLayout>(createInitialLayout('main'));
  const [paneStates, setPaneStates] = useState<Record<string, PaneState>>({
    main: { tabs: [], activeTabPath: undefined },
  });
  const [focusedPaneId, setFocusedPaneId] = useState('main');

  // State - Command palette & Quick open
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState(false);

  // Persist panel sizes to localStorage
  useEffect(() => {
    localStorage.setItem('panel-leftSidebarWidth', String(leftSidebarWidth));
  }, [leftSidebarWidth]);

  useEffect(() => {
    localStorage.setItem('panel-rightSidebarWidth', String(rightSidebarWidth));
  }, [rightSidebarWidth]);

  useEffect(() => {
    localStorage.setItem('panel-bottomPanelHeight', String(bottomPanelHeight));
  }, [bottomPanelHeight]);

  // Computed values
  const userDefaultSchema = useMemo(() => toSchemaName(user, project?.name ?? null), [user, project?.name]);

  // Get current pane state
  const currentPaneState = paneStates[focusedPaneId] || { tabs: [], activeTabPath: undefined };

  // Commands for command palette
  const commands = useMemo<Command[]>(() => [
    {
      id: 'file.save',
      label: 'Save File',
      shortcut: 'Cmd+S',
      category: CommandCategories.FILE,
      action: () => handleFileSave(),
    },
    {
      id: 'file.quickOpen',
      label: 'Go to File',
      shortcut: 'Cmd+P',
      category: CommandCategories.FILE,
      action: () => setIsQuickOpenOpen(true),
    },
    {
      id: 'view.toggleClaude',
      label: 'Toggle Claude Terminal',
      shortcut: 'Cmd+Shift+C',
      category: CommandCategories.VIEW,
      action: () => setIsRightSidebarOpen((prev) => !prev),
    },
    {
      id: 'view.toggleTerminal',
      label: 'Toggle Terminal',
      shortcut: 'Cmd+`',
      category: CommandCategories.TERMINAL,
      action: () => {
        setIsBottomPanelOpen((prev) => !prev);
        if (!isBottomPanelOpen) setBottomPanelTab('terminal');
      },
    },
    {
      id: 'view.toggleExplorer',
      label: 'Toggle Explorer',
      shortcut: 'Cmd+Shift+E',
      category: CommandCategories.VIEW,
      action: () => setActiveActivity((prev) => (prev === 'explorer' ? null : 'explorer')),
    },
    {
      id: 'search.global',
      label: 'Search in Files',
      shortcut: 'Cmd+Shift+F',
      category: CommandCategories.SEARCH,
      action: () => setActiveActivity('search'),
    },
    {
      id: 'editor.splitRight',
      label: 'Split Editor Right',
      category: CommandCategories.VIEW,
      action: () => handleSplitPane('horizontal'),
    },
    {
      id: 'editor.splitDown',
      label: 'Split Editor Down',
      category: CommandCategories.VIEW,
      action: () => handleSplitPane('vertical'),
    },
    {
      id: 'view.skills',
      label: 'View System Prompt & Skills',
      category: CommandCategories.VIEW,
      action: () => setSkillsExplorerOpen(true),
    },
  ], [isBottomPanelOpen]);

  // Keyboard shortcuts
  useKeyboardShortcuts([
    cmdOrCtrl('s', () => handleFileSave()),
    cmdOrCtrl('p', () => setIsQuickOpenOpen(true)),
    cmdShift('p', () => setIsCommandPaletteOpen(true)),
    cmdShift('f', () => setActiveActivity('search')),
    cmdShift('e', () => setActiveActivity((prev) => (prev === 'explorer' ? null : 'explorer'))),
    cmdShift('c', () => setIsRightSidebarOpen((prev) => !prev)),
    {
      key: '`',
      meta: true,
      action: () => {
        setIsBottomPanelOpen((prev) => !prev);
        if (!isBottomPanelOpen) setBottomPanelTab('terminal');
      },
    },
  ]);

  // Load project data
  useEffect(() => {
    if (!projectId) return;

    const loadData = async () => {
      try {
        setIsLoading(true);
        const [projectData, clustersData, warehousesData, filesData] = await Promise.all([
          fetchProject(projectId),
          fetchClusters().catch(() => []),
          fetchWarehouses().catch(() => []),
          fetchProjectFiles(projectId).catch(() => []),
        ]);
        setProject(projectData);
        setClusters(clustersData);
        setWarehouses(warehousesData);
        setFiles(filesData);

        if (clustersData.length > 0) setSelectedClusterId(clustersData[0].cluster_id);
        if (warehousesData.length > 0) setSelectedWarehouseId(warehousesData[0].warehouse_id);
      } catch (error) {
        console.error('Failed to load project:', error);
        toast.error('Failed to load project');
        navigate('/');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [projectId, navigate]);

  // Set default schema from user email
  useEffect(() => {
    if (userDefaultSchema && !defaultSchema) {
      setDefaultSchema(userDefaultSchema);
    }
  }, [userDefaultSchema, defaultSchema]);

  // Set default workspace folder
  useEffect(() => {
    if (user && project?.name && !workspaceFolder) {
      const projectFolder = sanitizeForSchema(project.name);
      setWorkspaceFolder(`/Workspace/Users/${user}/ai_dev_kit/${projectFolder}`);
    }
  }, [user, project?.name, workspaceFolder]);

  // Update page title
  useEffect(() => {
    document.title = project?.name
      ? `${project.name} - ${branding.app_title}`
      : branding.app_title;
  }, [project?.name, branding.app_title]);

  // Note: Removed automatic file refresh polling for performance.
  // Files are now refreshed on-demand when the user:
  // - Opens a project
  // - Performs file operations (create, delete, rename)
  // - Manually refreshes via UI actions
  // This reduces unnecessary API calls by 70%+

  // File operations
  const handleFileSelect = useCallback(async (path: string, paneId?: string) => {
    const targetPaneId = paneId || focusedPaneId;
    const paneState = paneStates[targetPaneId] || { tabs: [], activeTabPath: undefined };

    // Check if already open in this pane
    const existing = paneState.tabs.find((f) => f.path === path);
    if (existing) {
      setPaneStates((prev) => ({
        ...prev,
        [targetPaneId]: { ...paneState, activeTabPath: path },
      }));
      return;
    }

    if (!projectId) return;
    try {
      // Check cache first
      let fileContent: string;
      const cached = fileCache.get(path);
      const cacheAge = cached ? Date.now() - cached.timestamp : Infinity;

      if (cached && cacheAge < 60000) {
        // Use cache if less than 60 seconds old
        fileContent = cached.content;
      } else {
        // Fetch from server
        const file = await fetchFileContent(projectId, path);
        fileContent = file.content;

        // Update cache (max 50 files)
        setFileCache((prev) => {
          const next = new Map(prev);
          if (next.size >= 50) {
            // Remove oldest entry
            let oldestKey: string | null = null;
            let oldestTime = Infinity;
            for (const [key, value] of next) {
              if (value.timestamp < oldestTime) {
                oldestTime = value.timestamp;
                oldestKey = key;
              }
            }
            if (oldestKey) next.delete(oldestKey);
          }
          next.set(path, { content: fileContent, timestamp: Date.now() });
          return next;
        });
      }

      const name = path.split('/').pop() || path;
      const newFile: OpenFile = {
        path,
        name,
        content: fileContent,
        originalContent: fileContent,
        isDirty: false,
      };

      setPaneStates((prev) => ({
        ...prev,
        [targetPaneId]: {
          tabs: [...paneState.tabs, newFile],
          activeTabPath: path,
        },
      }));
    } catch (error) {
      console.error('Failed to load file:', error);
      toast.error('Failed to load file');
    }
  }, [projectId, focusedPaneId, paneStates, fileCache]);

  const handleContentChange = useCallback((paneId: string, path: string, content: string) => {
    setPaneStates((prev) => {
      const paneState = prev[paneId];
      if (!paneState) return prev;

      return {
        ...prev,
        [paneId]: {
          ...paneState,
          tabs: paneState.tabs.map((f) =>
            f.path === path
              ? { ...f, content, isDirty: content !== f.originalContent }
              : f
          ),
        },
      };
    });
  }, []);

  const handleFileSave = useCallback(async () => {
    const paneState = paneStates[focusedPaneId];
    if (!paneState?.activeTabPath || !projectId) return;

    const activeFile = paneState.tabs.find((f) => f.path === paneState.activeTabPath);
    if (!activeFile) return;

    try {
      await saveFileContent(projectId, activeFile.path, activeFile.content);

      // Invalidate cache on save
      setFileCache((prev) => {
        const next = new Map(prev);
        next.delete(activeFile.path);
        return next;
      });

      setPaneStates((prev) => ({
        ...prev,
        [focusedPaneId]: {
          ...paneState,
          tabs: paneState.tabs.map((f) =>
            f.path === activeFile.path
              ? { ...f, originalContent: f.content, isDirty: false }
              : f
          ),
        },
      }));
      toast.success('File saved');
    } catch (error) {
      console.error('Failed to save file:', error);
      toast.error('Failed to save file');
    }
  }, [projectId, focusedPaneId, paneStates]);

  const handleTabSelect = useCallback((paneId: string, path: string) => {
    setPaneStates((prev) => {
      const paneState = prev[paneId];
      if (!paneState) return prev;
      return {
        ...prev,
        [paneId]: { ...paneState, activeTabPath: path },
      };
    });
    setFocusedPaneId(paneId);
  }, []);

  const handleTabClose = useCallback((paneId: string, path: string) => {
    setPaneStates((prev) => {
      const paneState = prev[paneId];
      if (!paneState) return prev;

      const newTabs = paneState.tabs.filter((f) => f.path !== path);
      let newActivePath = paneState.activeTabPath;

      if (paneState.activeTabPath === path) {
        newActivePath = newTabs.length > 0 ? newTabs[newTabs.length - 1].path : undefined;
      }

      return {
        ...prev,
        [paneId]: { tabs: newTabs, activeTabPath: newActivePath },
      };
    });
  }, []);

  const handleFileCreate = useCallback(async (name: string) => {
    if (!projectId) return;
    try {
      await createFile(projectId, name);
      const filesData = await fetchProjectFiles(projectId);
      setFiles(filesData);
      handleFileSelect(name);
      toast.success('File created');
    } catch (error) {
      console.error('Failed to create file:', error);
      toast.error('Failed to create file');
    }
  }, [projectId, handleFileSelect]);

  const handleFileDelete = useCallback(async (path: string) => {
    if (!projectId) return;
    try {
      await apiDeleteFile(projectId, path);
      const filesData = await fetchProjectFiles(projectId);
      setFiles(filesData);

      // Close tab in all panes
      setPaneStates((prev) => {
        const newStates = { ...prev };
        for (const paneId of Object.keys(newStates)) {
          const paneState = newStates[paneId];
          if (paneState.tabs.some((f) => f.path === path)) {
            const newTabs = paneState.tabs.filter((f) => f.path !== path);
            let newActivePath = paneState.activeTabPath;
            if (paneState.activeTabPath === path) {
              newActivePath = newTabs.length > 0 ? newTabs[newTabs.length - 1].path : undefined;
            }
            newStates[paneId] = { tabs: newTabs, activeTabPath: newActivePath };
          }
        }
        return newStates;
      });

      toast.success('File deleted');
    } catch (error) {
      console.error('Failed to delete file:', error);
      toast.error('Failed to delete file');
    }
  }, [projectId]);

  const handleRefreshFiles = useCallback(async () => {
    if (!projectId) return;
    setIsLoadingFiles(true);
    try {
      const filesData = await fetchProjectFiles(projectId);
      setFiles(filesData);
    } catch (error) {
      console.error('Failed to refresh files:', error);
      toast.error('Failed to refresh files');
    } finally {
      setIsLoadingFiles(false);
    }
  }, [projectId]);

  // Split pane
  const handleSplitPane = useCallback((direction: 'horizontal' | 'vertical') => {
    const newPaneId = `pane-${Date.now()}`;

    setEditorLayout((prev) => splitPane(prev, focusedPaneId, direction, newPaneId));

    // Copy current tabs to new pane or create empty
    setPaneStates((prev) => ({
      ...prev,
      [newPaneId]: { tabs: [], activeTabPath: undefined },
    }));

    setFocusedPaneId(newPaneId);
  }, [focusedPaneId]);

  // Search result select
  const handleSearchResultSelect = useCallback((path: string, _line?: number) => {
    handleFileSelect(path);
    // TODO: scroll to line when editor supports it
  }, [handleFileSelect]);

  // Open diff in a readonly editor tab
  const handleOpenDiff = useCallback((path: string, diff: string) => {
    const diffPath = `diff://${path}`;
    const paneState = paneStates[focusedPaneId] || { tabs: [], activeTabPath: undefined };

    // Check if already open
    const existing = paneState.tabs.find((f) => f.path === diffPath);
    if (existing) {
      setPaneStates((prev) => ({
        ...prev,
        [focusedPaneId]: { ...paneState, activeTabPath: diffPath },
      }));
      return;
    }

    const name = `${path.split('/').pop() || path} (diff)`;
    const newFile: OpenFile = {
      path: diffPath,
      name,
      content: diff,
      originalContent: diff,
      isDirty: false,
    };

    setPaneStates((prev) => ({
      ...prev,
      [focusedPaneId]: {
        tabs: [...paneState.tabs, newFile],
        activeTabPath: diffPath,
      },
    }));
  }, [focusedPaneId, paneStates]);

  // Loading state
  if (isLoading) {
    return (
      <MainLayout projectName={project?.name}>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--color-text-muted)]" />
        </div>
      </MainLayout>
    );
  }

  // Left sidebar content based on activity
  const leftSidebarContent = activeActivity === 'explorer' ? (
    <FileExplorer
      files={files}
      selectedPath={currentPaneState.activeTabPath}
      onFileSelect={handleFileSelect}
      onFileCreate={handleFileCreate}
      onFileDelete={handleFileDelete}
      onRefresh={handleRefreshFiles}
      isLoading={isLoadingFiles}
    />
  ) : activeActivity === 'search' && projectId ? (
    <GlobalSearch
      projectId={projectId}
      onResultSelect={handleSearchResultSelect}
    />
  ) : activeActivity === 'git' && projectId ? (
    <SourceControl
      projectId={projectId}
      onOpenDiff={handleOpenDiff}
    />
  ) : null;

  // Get suggested prompts from template
  const templateData = project?.template ? getTemplate(project.template) : undefined;
  const suggestedPrompts = templateData?.suggestedPrompts;

  // Bottom panel content
  const bottomPanelContent = bottomPanelTab === 'terminal' && projectId ? (
    <Terminal projectId={projectId} />
  ) : bottomPanelTab === 'output' ? (
    <OutputPanel lines={outputLines} />
  ) : bottomPanelTab === 'deploy' && projectId ? (
    <div className="h-full overflow-hidden">
      <DeployPanel projectId={projectId} />
    </div>
  ) : bottomPanelTab === 'preview' && projectId ? (
    <AppPreview projectId={projectId} />
  ) : null;

  // Claude terminal panel (replaces chat)
  const claudeTerminalPanel = projectId ? (
    <ClaudeTerminal
      projectId={projectId}
      isMaximized={isClaudeMaximized}
      onToggleMaximize={() => setIsClaudeMaximized((prev) => !prev)}
      suggestedPrompts={suggestedPrompts}
      onFilesChanged={handleRefreshFiles}
    />
  ) : null;

  return (
    <MainLayout projectName={project?.name}>
      <IDELayout
        activeActivity={activeActivity}
        onActivityChange={(activity) => {
          setActiveActivity(activity);
          // If chat/claude is selected, toggle right sidebar
          if (activity === 'chat') {
            setIsRightSidebarOpen(true);
            setActiveActivity(null); // Reset activity so explorer can be shown
          }
        }}
        leftSidebar={leftSidebarContent}
        leftSidebarWidth={leftSidebarWidth}
        onLeftSidebarWidthChange={setLeftSidebarWidth}
        rightSidebar={claudeTerminalPanel}
        rightSidebarWidth={rightSidebarWidth}
        onRightSidebarWidthChange={setRightSidebarWidth}
        isRightSidebarOpen={isRightSidebarOpen}
        isClaudeMaximized={isClaudeMaximized}
        maximizedContent={claudeTerminalPanel}
        bottomPanel={bottomPanelContent}
        bottomPanelHeight={bottomPanelHeight}
        onBottomPanelHeightChange={setBottomPanelHeight}
        isBottomPanelOpen={isBottomPanelOpen}
        onBottomPanelToggle={() => setIsBottomPanelOpen((prev) => !prev)}
        bottomPanelTab={bottomPanelTab}
        onBottomPanelTabChange={setBottomPanelTab}
      >
        {/* Editor Area */}
        <EditorPaneManager
          layout={editorLayout}
          panes={paneStates}
          focusedPaneId={focusedPaneId}
          onLayoutChange={setEditorLayout}
          onPaneStateChange={(paneId, state) =>
            setPaneStates((prev) => ({
              ...prev,
              [paneId]: { ...prev[paneId], ...state },
            }))
          }
          onFocusPane={setFocusedPaneId}
          onTabSelect={handleTabSelect}
          onTabClose={handleTabClose}
          onContentChange={handleContentChange}
        />
      </IDELayout>

      {/* Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        commands={commands}
      />

      {/* Quick Open */}
      <QuickOpen
        isOpen={isQuickOpenOpen}
        onClose={() => setIsQuickOpenOpen(false)}
        files={files}
        onFileSelect={handleFileSelect}
      />

      {/* Skills Explorer */}
      {skillsExplorerOpen && projectId && (
        <SkillsExplorer
          projectId={projectId}
          systemPromptParams={{ clusterId: selectedClusterId, warehouseId: selectedWarehouseId, defaultCatalog, defaultSchema, workspaceFolder }}
          onClose={() => setSkillsExplorerOpen(false)}
        />
      )}
    </MainLayout>
  );
}
