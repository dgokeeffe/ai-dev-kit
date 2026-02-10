import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Code,
  Eye,
  File,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import {
  fetchSkillFile,
  fetchSkillsTree,
  fetchSystemPrompt,
  reloadProjectSkills,
  type FetchSystemPromptParams,
  type SkillTreeNode,
} from '@/lib/api';

interface TreeNodeProps {
  node: SkillTreeNode;
  level: number;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}

function TreeNode({
  node,
  level,
  selectedPath,
  expandedPaths,
  onSelect,
  onToggle,
}: TreeNodeProps) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const isDirectory = node.type === 'directory';
  const isMarkdown = node.name.endsWith('.md');

  const handleClick = () => {
    if (isDirectory) {
      onToggle(node.path);
    } else {
      onSelect(node.path);
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors',
          isSelected
            ? 'bg-[var(--color-accent-primary)]/10 text-[var(--color-accent-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]'
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        {isDirectory ? (
          <>
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 flex-shrink-0 text-[var(--color-text-muted)]" />
            ) : (
              <ChevronRight className="h-3 w-3 flex-shrink-0 text-[var(--color-text-muted)]" />
            )}
            {isExpanded ? (
              <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-[var(--color-warning)]" />
            ) : (
              <Folder className="h-3.5 w-3.5 flex-shrink-0 text-[var(--color-warning)]" />
            )}
          </>
        ) : (
          <>
            <span className="w-3" />
            {isMarkdown ? (
              <FileText className="h-3.5 w-3.5 flex-shrink-0 text-[var(--color-accent-secondary)]" />
            ) : (
              <File className="h-3.5 w-3.5 flex-shrink-0 text-[var(--color-text-muted)]" />
            )}
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>

      {isDirectory && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              level={level + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SkillsExplorerProps {
  projectId: string;
  systemPromptParams: FetchSystemPromptParams;
  onClose: () => void;
}

export function SkillsExplorer({
  projectId,
  systemPromptParams,
  onClose,
}: SkillsExplorerProps) {
  const [tree, setTree] = useState<SkillTreeNode[]>([]);
  const [isLoadingTree, setIsLoadingTree] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<'system_prompt' | 'skill'>('system_prompt');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [content, setContent] = useState<string>('');
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [showRawCode, setShowRawCode] = useState(false);
  const [isReloading, setIsReloading] = useState(false);

  // Load skills tree
  useEffect(() => {
    const loadTree = async () => {
      try {
        setIsLoadingTree(true);
        const treeData = await fetchSkillsTree(projectId);
        setTree(treeData);

        // Auto-expand first level directories
        const initialExpanded = new Set<string>();
        treeData.forEach((node) => {
          if (node.type === 'directory') {
            initialExpanded.add(node.path);
          }
        });
        setExpandedPaths(initialExpanded);
      } catch (error) {
        console.error('Failed to load skills tree:', error);
      } finally {
        setIsLoadingTree(false);
      }
    };

    loadTree();
  }, [projectId]);

  // Load system prompt by default
  useEffect(() => {
    const loadSystemPrompt = async () => {
      try {
        setIsLoadingContent(true);
        const prompt = await fetchSystemPrompt(systemPromptParams);
        setContent(prompt);
        setSelectedType('system_prompt');
      } catch (error) {
        console.error('Failed to load system prompt:', error);
        setContent('Error loading system prompt');
      } finally {
        setIsLoadingContent(false);
      }
    };

    loadSystemPrompt();
  }, [systemPromptParams]);

  const handleSelectSystemPrompt = useCallback(async () => {
    setSelectedPath(null);
    setSelectedType('system_prompt');
    setIsLoadingContent(true);
    try {
      const prompt = await fetchSystemPrompt(systemPromptParams);
      setContent(prompt);
    } catch (error) {
      console.error('Failed to load system prompt:', error);
      setContent('Error loading system prompt');
    } finally {
      setIsLoadingContent(false);
    }
  }, [systemPromptParams]);

  const handleSelectSkill = useCallback(
    async (path: string) => {
      setSelectedPath(path);
      setSelectedType('skill');
      setIsLoadingContent(true);
      try {
        const file = await fetchSkillFile(projectId, path);
        setContent(file.content);
      } catch (error) {
        console.error('Failed to load skill file:', error);
        setContent('Error loading file');
      } finally {
        setIsLoadingContent(false);
      }
    },
    [projectId]
  );

  const handleToggle = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleReloadSkills = useCallback(async () => {
    setIsReloading(true);
    try {
      await reloadProjectSkills(projectId);
      // Reload the tree after skills are refreshed
      const treeData = await fetchSkillsTree(projectId);
      setTree(treeData);
      // Auto-expand first level directories
      const initialExpanded = new Set<string>();
      treeData.forEach((node) => {
        if (node.type === 'directory') {
          initialExpanded.add(node.path);
        }
      });
      setExpandedPaths(initialExpanded);
      // Reset selection to system prompt
      setSelectedPath(null);
      setSelectedType('system_prompt');
    } catch (error) {
      console.error('Failed to reload skills:', error);
    } finally {
      setIsReloading(false);
    }
  }, [projectId]);

  const isMarkdownFile = selectedType === 'system_prompt' || selectedPath?.endsWith('.md');

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Content */}
      <div className="relative z-10 flex w-full h-full m-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] shadow-2xl overflow-hidden">
        {/* Left sidebar - Navigation */}
        <div className="w-64 flex-shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]/30 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <h2 className="text-sm font-semibold text-[var(--color-text-heading)]">
              Documentation
            </h2>
          </div>

          {/* Navigation content */}
          <div className="flex-1 overflow-y-auto p-2">
            {/* System Prompt */}
            <button
              onClick={handleSelectSystemPrompt}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors mb-2',
                selectedType === 'system_prompt'
                  ? 'bg-[var(--color-accent-primary)]/10 text-[var(--color-accent-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]'
              )}
            >
              <Sparkles className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="font-medium">System Prompt</span>
            </button>

            {/* Divider */}
            <div className="my-2 border-t border-[var(--color-border)]" />

            {/* Reload Skills Button */}
            <button
              onClick={handleReloadSkills}
              disabled={isReloading}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-3 shadow-sm"
            >
              <RefreshCw className={cn('h-3.5 w-3.5 flex-shrink-0', isReloading && 'animate-spin')} />
              <span>{isReloading ? 'Reloading...' : 'Reload project skills'}</span>
            </button>

            {/* Skills label */}
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Skills
            </div>

            {/* Skills tree */}
            {isLoadingTree ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-muted)]" />
              </div>
            ) : tree.length === 0 ? (
              <div className="px-2 py-4 text-xs text-[var(--color-text-muted)]">
                No skills available
              </div>
            ) : (
              <div className="space-y-0.5">
                {tree.map((node) => (
                  <TreeNode
                    key={node.path}
                    node={node}
                    level={0}
                    selectedPath={selectedPath}
                    expandedPaths={expandedPaths}
                    onSelect={handleSelectSkill}
                    onToggle={handleToggle}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right panel - Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2 min-w-0">
              {selectedType === 'system_prompt' ? (
                <>
                  <Sparkles className="h-4 w-4 flex-shrink-0 text-[var(--color-accent-primary)]" />
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-[var(--color-text-heading)] truncate">
                      System Prompt
                    </h3>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Instructions injected to Claude Code
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 flex-shrink-0 text-[var(--color-accent-secondary)]" />
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-[var(--color-text-heading)] truncate">
                      {selectedPath?.split('/').pop() || 'Select a file'}
                    </h3>
                    <p className="text-xs text-[var(--color-text-muted)] truncate">
                      {selectedPath || 'Choose a skill file from the sidebar'}
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Toggle raw/rendered for markdown */}
              {isMarkdownFile && (
                <button
                  onClick={() => setShowRawCode(!showRawCode)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors',
                    showRawCode
                      ? 'bg-[var(--color-accent-primary)]/10 text-[var(--color-accent-primary)]'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]'
                  )}
                >
                  {showRawCode ? (
                    <>
                      <Eye className="h-3 w-3" />
                      Rendered
                    </>
                  ) : (
                    <>
                      <Code className="h-3 w-3" />
                      Raw
                    </>
                  )}
                </button>
              )}

              {/* Close button */}
              <button
                onClick={onClose}
                className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto p-5">
            {isLoadingContent ? (
              <div className="flex items-center justify-center py-20">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--color-accent-primary)]" />
                  <p className="text-xs text-[var(--color-text-muted)]">Loading...</p>
                </div>
              </div>
            ) : showRawCode || !isMarkdownFile ? (
              <pre className="text-xs font-mono text-[var(--color-text-primary)] whitespace-pre-wrap break-words bg-[var(--color-bg-secondary)]/50 p-4 rounded-lg border border-[var(--color-border)]">
                {content}
              </pre>
            ) : (
              <div className="prose prose-xs max-w-none text-[var(--color-text-primary)] text-xs leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
