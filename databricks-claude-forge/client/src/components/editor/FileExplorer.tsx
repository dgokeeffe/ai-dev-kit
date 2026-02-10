import { memo, useCallback, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { cn, getFileExtension } from '@/lib/utils';
import type { FileNode } from '@/lib/types';

interface FileExplorerProps {
  files: FileNode[];
  selectedPath?: string;
  onFileSelect: (path: string) => void;
  onFileCreate?: (path: string) => void;
  onFileDelete?: (path: string) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
  className?: string;
}

interface FileTreeItemProps {
  node: FileNode;
  depth: number;
  selectedPath?: string;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onFileSelect: (path: string) => void;
  onFileDelete?: (path: string) => void;
}

/**
 * Get icon for file based on extension
 */
function getFileIcon(name: string, isDir: boolean, isExpanded: boolean) {
  if (isDir) {
    return isExpanded ? (
      <FolderOpen className="h-4 w-4 text-yellow-500" />
    ) : (
      <Folder className="h-4 w-4 text-yellow-500" />
    );
  }

  const ext = getFileExtension(name);
  switch (ext) {
    case 'py':
      return <FileCode className="h-4 w-4 text-blue-400" />;
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return <FileCode className="h-4 w-4 text-yellow-400" />;
    case 'json':
      return <FileJson className="h-4 w-4 text-orange-400" />;
    case 'yaml':
    case 'yml':
      return <FileText className="h-4 w-4 text-purple-400" />;
    case 'sql':
      return <FileCode className="h-4 w-4 text-green-400" />;
    case 'md':
      return <FileText className="h-4 w-4 text-gray-400" />;
    default:
      return <File className="h-4 w-4 text-gray-400" />;
  }
}

const FileTreeItem = memo(function FileTreeItem({
  node,
  depth,
  selectedPath,
  expandedPaths,
  onToggleExpand,
  onFileSelect,
  onFileDelete,
}: FileTreeItemProps) {
  const isDir = node.type === 'directory';
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = useCallback(() => {
    if (isDir) {
      onToggleExpand(node.path);
    } else {
      onFileSelect(node.path);
    }
  }, [isDir, node.path, onToggleExpand, onFileSelect]);

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onFileDelete && confirm(`Delete ${node.name}?`)) {
        onFileDelete(node.path);
      }
    },
    [node.name, node.path, onFileDelete]
  );

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-[var(--color-bg-secondary)] transition-colors',
          isSelected && 'bg-[var(--color-accent-primary)]/20 hover:bg-[var(--color-accent-primary)]/30'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Expand/collapse icon for directories */}
        {isDir ? (
          <span className="w-4 h-4 flex items-center justify-center text-[var(--color-text-muted)]">
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </span>
        ) : (
          <span className="w-4 h-4" />
        )}

        {/* File/folder icon */}
        {getFileIcon(node.name, isDir, isExpanded)}

        {/* Name */}
        <span className="flex-1 text-xs text-[var(--color-text-primary)] truncate">
          {node.name}
        </span>

        {/* Delete button */}
        {isHovered && onFileDelete && !isDir && (
          <button
            onClick={handleDelete}
            className="p-0.5 rounded hover:bg-red-500/20 text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
            title="Delete file"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Render children if expanded */}
      {isDir && isExpanded && node.children && (
        <>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              onFileSelect={onFileSelect}
              onFileDelete={onFileDelete}
            />
          ))}
        </>
      )}
    </>
  );
});

export function FileExplorer({
  files,
  selectedPath,
  onFileSelect,
  onFileCreate,
  onFileDelete,
  onRefresh,
  isLoading = false,
  className = '',
}: FileExplorerProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const handleToggleExpand = useCallback((path: string) => {
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

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
        <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
          Files
        </span>
        <div className="flex items-center gap-1">
          {onFileCreate && (
            <button
              onClick={() => {
                const name = prompt('Enter file name:');
                if (name) onFileCreate(name);
              }}
              className="p-1 rounded hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
              title="New file"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="p-1 rounded hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
            </button>
          )}
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {files.length === 0 ? (
          <div className="px-3 py-4 text-xs text-[var(--color-text-muted)] text-center">
            {isLoading ? 'Loading files...' : 'No files yet'}
          </div>
        ) : (
          files.map((node) => (
            <FileTreeItem
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onToggleExpand={handleToggleExpand}
              onFileSelect={onFileSelect}
              onFileDelete={onFileDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
