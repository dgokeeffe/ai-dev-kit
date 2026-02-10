import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { File, Search, X } from 'lucide-react';
import { cn, getFileExtension } from '@/lib/utils';
import type { FileNode } from '@/lib/types';

interface QuickOpenProps {
  isOpen: boolean;
  onClose: () => void;
  files: FileNode[];
  onFileSelect: (path: string) => void;
}

// Flatten file tree into list of file paths
function flattenFiles(nodes: FileNode[], parentPath: string = ''): { path: string; name: string }[] {
  const result: { path: string; name: string }[] = [];

  for (const node of nodes) {
    const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;

    if (node.type === 'file') {
      result.push({ path: fullPath, name: node.name });
    }

    if (node.children) {
      result.push(...flattenFiles(node.children, fullPath));
    }
  }

  return result;
}

// Simple fuzzy match
function fuzzyMatch(query: string, target: string): { match: boolean; score: number } {
  const lowerQuery = query.toLowerCase();
  const lowerTarget = target.toLowerCase();

  // Exact match gets highest score
  if (lowerTarget === lowerQuery) {
    return { match: true, score: 100 };
  }

  // Contains match
  if (lowerTarget.includes(lowerQuery)) {
    // Higher score if query is at start
    const index = lowerTarget.indexOf(lowerQuery);
    const score = 80 - index;
    return { match: true, score };
  }

  // Fuzzy match - all characters in order
  let queryIndex = 0;
  let score = 0;
  for (let i = 0; i < lowerTarget.length && queryIndex < lowerQuery.length; i++) {
    if (lowerTarget[i] === lowerQuery[queryIndex]) {
      queryIndex++;
      score += 1;
    }
  }

  if (queryIndex === lowerQuery.length) {
    return { match: true, score };
  }

  return { match: false, score: 0 };
}

function getFileIcon(name: string) {
  const ext = getFileExtension(name);
  const colorMap: Record<string, string> = {
    py: 'text-blue-400',
    js: 'text-yellow-400',
    jsx: 'text-yellow-400',
    ts: 'text-blue-400',
    tsx: 'text-blue-400',
    json: 'text-orange-400',
    yaml: 'text-purple-400',
    yml: 'text-purple-400',
    md: 'text-gray-400',
    sql: 'text-green-400',
  };
  return <File className={cn('h-4 w-4', colorMap[ext] || 'text-gray-400')} />;
}

export function QuickOpen({ isOpen, onClose, files, onFileSelect }: QuickOpenProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Flatten files
  const allFiles = useMemo(() => flattenFiles(files), [files]);

  // Filter and sort files based on query
  const filteredFiles = useMemo(() => {
    if (!query) {
      return allFiles.slice(0, 50); // Limit results when no query
    }

    return allFiles
      .map((file) => {
        const pathMatch = fuzzyMatch(query, file.path);
        const nameMatch = fuzzyMatch(query, file.name);
        const bestScore = Math.max(pathMatch.score, nameMatch.score * 1.5); // Prefer name matches
        return { ...file, score: bestScore, match: pathMatch.match || nameMatch.match };
      })
      .filter((file) => file.match)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
  }, [allFiles, query]);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.children[selectedIndex] as HTMLElement;
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredFiles.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredFiles[selectedIndex]) {
            onFileSelect(filteredFiles[selectedIndex].path);
            onClose();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filteredFiles, selectedIndex, onFileSelect, onClose]
  );

  const handleSelect = useCallback(
    (path: string) => {
      onFileSelect(path);
      onClose();
    },
    [onFileSelect, onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Quick Open */}
      <div className="relative w-full max-w-lg bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg shadow-xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 border-b border-[var(--color-border)]">
          <Search className="h-4 w-4 text-[var(--color-text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search files by name..."
            className="flex-1 h-12 bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none"
          />
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* File list */}
        <div
          ref={listRef}
          className="max-h-80 overflow-y-auto py-2"
        >
          {filteredFiles.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-[var(--color-text-muted)]">
              {query ? 'No files found' : 'No files in project'}
            </div>
          ) : (
            filteredFiles.map((file, index) => (
              <button
                key={file.path}
                onClick={() => handleSelect(file.path)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors',
                  index === selectedIndex
                    ? 'bg-[var(--color-accent-primary)]/10 text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'
                )}
              >
                {getFileIcon(file.name)}
                <span className="truncate">{file.name}</span>
                <span className="ml-auto text-xs text-[var(--color-text-muted)] truncate max-w-[200px]">
                  {file.path}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
