import { useCallback, memo } from 'react';
import { X, FileCode, File, FileText, FileJson } from 'lucide-react';
import { cn, getFileExtension } from '@/lib/utils';

interface FileTab {
  path: string;
  name: string;
  isDirty?: boolean;
}

interface FileTabsProps {
  tabs: FileTab[];
  activeTab?: string;
  onTabSelect: (path: string) => void;
  onTabClose: (path: string) => void;
  className?: string;
}

/**
 * Get small icon for tab based on file extension
 */
function getTabIcon(name: string) {
  const ext = getFileExtension(name);
  switch (ext) {
    case 'py':
      return <FileCode className="h-3.5 w-3.5 text-blue-400" />;
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return <FileCode className="h-3.5 w-3.5 text-yellow-400" />;
    case 'json':
      return <FileJson className="h-3.5 w-3.5 text-orange-400" />;
    case 'yaml':
    case 'yml':
      return <FileText className="h-3.5 w-3.5 text-purple-400" />;
    case 'sql':
      return <FileCode className="h-3.5 w-3.5 text-green-400" />;
    case 'md':
      return <FileText className="h-3.5 w-3.5 text-gray-400" />;
    default:
      return <File className="h-3.5 w-3.5 text-gray-400" />;
  }
}

export const FileTabs = memo(function FileTabs({
  tabs,
  activeTab,
  onTabSelect,
  onTabClose,
  className = '',
}: FileTabsProps) {
  const handleClose = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      onTabClose(path);
    },
    [onTabClose]
  );

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex items-center border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/50 overflow-x-auto',
        className
      )}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.path;
        return (
          <button
            key={tab.path}
            onClick={() => onTabSelect(tab.path)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs border-r border-[var(--color-border)] min-w-0 max-w-[150px] group transition-colors',
              isActive
                ? 'bg-[var(--color-background)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-background)]/50 hover:text-[var(--color-text-primary)]'
            )}
          >
            {/* File icon */}
            {getTabIcon(tab.name)}

            {/* File name */}
            <span className="truncate">
              {tab.name}
              {tab.isDirty && <span className="text-[var(--color-accent-primary)]">*</span>}
            </span>

            {/* Close button */}
            <span
              onClick={(e) => handleClose(e, tab.path)}
              className={cn(
                'ml-auto p-0.5 rounded hover:bg-[var(--color-bg-secondary)] transition-colors',
                isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              )}
              title="Close"
            >
              <X className="h-3 w-3" />
            </span>
          </button>
        );
      })}
    </div>
  );
});
