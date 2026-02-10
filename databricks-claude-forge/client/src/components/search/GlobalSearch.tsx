import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X, CaseSensitive, Regex, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SearchResults, SearchResult } from './SearchResults';
import { searchFiles } from '@/lib/api';

interface GlobalSearchProps {
  projectId: string;
  onResultSelect: (path: string, line?: number) => void;
  className?: string;
}

export function GlobalSearch({ projectId, onResultSelect, className = '' }: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [fileGlob, setFileGlob] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const searchResults = await searchFiles(projectId, {
        query: searchQuery,
        caseSensitive,
        regex: useRegex,
        glob: fileGlob || undefined,
      });
      setResults(searchResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [projectId, caseSensitive, useRegex, fileGlob]);

  // Debounce search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      performSearch(query);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, performSearch]);

  // Re-search when options change
  useEffect(() => {
    if (query.trim()) {
      performSearch(query);
    }
  }, [caseSensitive, useRegex, fileGlob]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setQuery('');
      setResults([]);
    }
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Search header */}
      <div className="flex-shrink-0 p-2 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-1">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search in files..."
              className="w-full h-7 pl-7 pr-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]/50"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setResults([]); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Search options */}
        <div className="flex items-center gap-1 mt-2">
          <button
            onClick={() => setCaseSensitive(!caseSensitive)}
            className={cn(
              'flex items-center justify-center h-6 w-6 rounded transition-colors',
              caseSensitive
                ? 'bg-[var(--color-accent-primary)]/20 text-[var(--color-accent-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]'
            )}
            title="Match case"
          >
            <CaseSensitive className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setUseRegex(!useRegex)}
            className={cn(
              'flex items-center justify-center h-6 w-6 rounded transition-colors',
              useRegex
                ? 'bg-[var(--color-accent-primary)]/20 text-[var(--color-accent-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]'
            )}
            title="Use regular expression"
          >
            <Regex className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'flex items-center justify-center h-6 w-6 rounded transition-colors',
              showFilters || fileGlob
                ? 'bg-[var(--color-accent-primary)]/20 text-[var(--color-accent-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]'
            )}
            title="Filter files"
          >
            <Filter className="h-3.5 w-3.5" />
          </button>

          <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
            {isSearching ? 'Searching...' : results.length > 0 ? `${results.length} results` : ''}
          </span>
        </div>

        {/* File filter input */}
        {showFilters && (
          <div className="mt-2">
            <input
              type="text"
              value={fileGlob}
              onChange={(e) => setFileGlob(e.target.value)}
              placeholder="File filter (e.g., *.py, src/**/*.ts)"
              className="w-full h-7 px-2 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]/50"
            />
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="p-3 text-xs text-red-400">{error}</div>
        ) : results.length === 0 && query ? (
          <div className="p-3 text-xs text-[var(--color-text-muted)] text-center">
            {isSearching ? 'Searching...' : 'No results found'}
          </div>
        ) : results.length === 0 ? (
          <div className="p-3 text-xs text-[var(--color-text-muted)] text-center">
            Enter a search term to find in files
          </div>
        ) : (
          <SearchResults
            results={results}
            onResultSelect={onResultSelect}
          />
        )}
      </div>
    </div>
  );
}
