import { useState, useMemo } from 'react';
import { File, ChevronRight, ChevronDown } from 'lucide-react';
import { cn, getFileExtension } from '@/lib/utils';

export interface SearchResult {
  path: string;
  line_number: number;
  line_content: string;
  match_start: number;
  match_end: number;
}

interface GroupedResult {
  path: string;
  matches: SearchResult[];
}

interface SearchResultsProps {
  results: SearchResult[];
  onResultSelect: (path: string, line?: number) => void;
  className?: string;
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
  return <File className={cn('h-3.5 w-3.5 flex-shrink-0', colorMap[ext] || 'text-gray-400')} />;
}

export function SearchResults({ results, onResultSelect, className = '' }: SearchResultsProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  // Group results by file
  const groupedResults = useMemo(() => {
    const groups: Record<string, GroupedResult> = {};

    for (const result of results) {
      if (!groups[result.path]) {
        groups[result.path] = { path: result.path, matches: [] };
      }
      groups[result.path].matches.push(result);
    }

    // Expand all by default
    const paths = Object.keys(groups);
    if (expandedFiles.size === 0 && paths.length > 0) {
      setExpandedFiles(new Set(paths));
    }

    return Object.values(groups);
  }, [results]);

  const toggleFile = (path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Highlight match in line content
  const highlightMatch = (content: string, start: number, end: number) => {
    const before = content.slice(0, start);
    const match = content.slice(start, end);
    const after = content.slice(end);

    return (
      <>
        <span className="text-[var(--color-text-muted)]">{before}</span>
        <span className="bg-[var(--color-accent-primary)]/30 text-[var(--color-accent-primary)]">{match}</span>
        <span className="text-[var(--color-text-muted)]">{after}</span>
      </>
    );
  };

  return (
    <div className={cn('text-xs', className)}>
      {groupedResults.map((group) => {
        const isExpanded = expandedFiles.has(group.path);
        const fileName = group.path.split('/').pop() || group.path;

        return (
          <div key={group.path}>
            {/* File header */}
            <button
              onClick={() => toggleFile(group.path)}
              className="w-full flex items-center gap-1 px-2 py-1 hover:bg-[var(--color-bg-secondary)] text-left"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 text-[var(--color-text-muted)]" />
              ) : (
                <ChevronRight className="h-3 w-3 text-[var(--color-text-muted)]" />
              )}
              {getFileIcon(fileName)}
              <span className="text-[var(--color-text-primary)] truncate">{fileName}</span>
              <span className="ml-auto text-[var(--color-text-muted)]">
                {group.matches.length}
              </span>
            </button>

            {/* Matches */}
            {isExpanded && (
              <div className="ml-4">
                {group.matches.map((match, index) => (
                  <button
                    key={`${match.path}-${match.line_number}-${index}`}
                    onClick={() => onResultSelect(match.path, match.line_number)}
                    className="w-full flex items-start gap-2 px-2 py-1 hover:bg-[var(--color-bg-secondary)] text-left group"
                  >
                    <span className="text-[var(--color-text-muted)] w-8 text-right flex-shrink-0">
                      {match.line_number}
                    </span>
                    <span className="truncate font-mono">
                      {highlightMatch(
                        match.line_content.trim(),
                        match.match_start,
                        match.match_end
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
