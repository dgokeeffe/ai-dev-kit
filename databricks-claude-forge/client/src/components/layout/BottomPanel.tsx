import { useRef, useEffect, ReactNode } from 'react';
import { Terminal as TerminalIcon, FileOutput, Rocket, Globe, ChevronDown, ChevronUp, GripHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export type BottomPanelTab = 'terminal' | 'output' | 'deploy' | 'preview';

interface Tab {
  id: BottomPanelTab;
  label: string;
  icon: typeof TerminalIcon;
}

const tabs: Tab[] = [
  { id: 'terminal', label: 'Terminal', icon: TerminalIcon },
  { id: 'output', label: 'Output', icon: FileOutput },
  { id: 'deploy', label: 'Deploy', icon: Rocket },
  { id: 'preview', label: 'Preview', icon: Globe },
];

interface BottomPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  activeTab: BottomPanelTab;
  onTabChange: (tab: BottomPanelTab) => void;
  height: number;
  onHeightChange: (height: number) => void;
  children: ReactNode;
  className?: string;
}

export function BottomPanel({
  isOpen,
  onToggle,
  activeTab,
  onTabChange,
  height,
  onHeightChange,
  children,
  className = '',
}: BottomPanelProps) {
  const resizeRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Handle resize
  useEffect(() => {
    const resizeEl = resizeRef.current;
    if (!resizeEl) return;

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    const handleMouseDown = (e: MouseEvent) => {
      isResizing = true;
      startY = e.clientY;
      startHeight = height;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const deltaY = startY - e.clientY;
      const newHeight = Math.min(Math.max(startHeight + deltaY, 150), 700);
      onHeightChange(newHeight);
    };

    const handleMouseUp = () => {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    resizeEl.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      resizeEl.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [height, onHeightChange]);

  return (
    <div
      ref={panelRef}
      className={cn('flex flex-col border-t border-[var(--color-border)] bg-[var(--color-background)]', className)}
      style={{ height: isOpen ? height : 'auto' }}
    >
      {/* Resize handle - only show when open */}
      {isOpen && (
        <div
          ref={resizeRef}
          className="h-1 bg-[var(--color-border)] hover:bg-[var(--color-accent-primary)]/50 cursor-row-resize flex items-center justify-center"
        >
          <GripHorizontal className="h-3 w-3 text-[var(--color-text-muted)]" />
        </div>
      )}

      {/* Tab bar */}
      <div className="flex items-center h-9 bg-[var(--color-bg-secondary)]/50 border-b border-[var(--color-border)]">
        {/* Tabs */}
        <div className="flex items-center">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  onTabChange(tab.id);
                  if (!isOpen) onToggle();
                }}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-[var(--color-border)] transition-colors',
                  isActive
                    ? 'text-[var(--color-text-primary)] bg-[var(--color-background)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)]/50'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Toggle button */}
        <button
          onClick={onToggle}
          className="flex items-center justify-center h-full px-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          title={isOpen ? 'Collapse panel' : 'Expand panel'}
        >
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
      </div>

      {/* Content - only show when open */}
      {isOpen && (
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      )}
    </div>
  );
}
