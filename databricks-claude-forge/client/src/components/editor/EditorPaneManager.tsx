import { useCallback, useRef, useEffect } from 'react';
import { GripVertical, GripHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EditorPane, OpenFile } from './EditorPane';

export type SplitDirection = 'horizontal' | 'vertical';

export interface PaneLayout {
  type: 'leaf' | 'split';
  // For leaf nodes
  paneId?: string;
  // For split nodes
  direction?: SplitDirection;
  first?: PaneLayout;
  second?: PaneLayout;
  splitRatio?: number; // 0-100
}

export interface PaneState {
  tabs: OpenFile[];
  activeTabPath?: string;
}

interface EditorPaneManagerProps {
  layout: PaneLayout;
  panes: Record<string, PaneState>;
  focusedPaneId: string;
  onLayoutChange: (layout: PaneLayout) => void;
  onPaneStateChange?: (paneId: string, state: Partial<PaneState>) => void;
  onFocusPane: (paneId: string) => void;
  onTabSelect: (paneId: string, path: string) => void;
  onTabClose: (paneId: string, path: string) => void;
  onContentChange: (paneId: string, path: string, content: string) => void;
  className?: string;
}

interface SplitPaneProps {
  direction: SplitDirection;
  first: PaneLayout;
  second: PaneLayout;
  splitRatio: number;
  onSplitRatioChange: (ratio: number) => void;
  renderPane: (layout: PaneLayout) => React.ReactNode;
}

function SplitPane({
  direction,
  first,
  second,
  splitRatio,
  onSplitRatioChange,
  renderPane,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const resizeEl = resizeRef.current;
    const container = containerRef.current;
    if (!resizeEl || !container) return;

    let isResizing = false;

    const handleMouseDown = () => {
      isResizing = true;
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const rect = container.getBoundingClientRect();

      let newRatio: number;
      if (direction === 'horizontal') {
        newRatio = ((e.clientX - rect.left) / rect.width) * 100;
      } else {
        newRatio = ((e.clientY - rect.top) / rect.height) * 100;
      }

      onSplitRatioChange(Math.min(Math.max(newRatio, 20), 80));
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
  }, [direction, onSplitRatioChange]);

  const isHorizontal = direction === 'horizontal';

  return (
    <div
      ref={containerRef}
      className={cn('flex h-full', isHorizontal ? 'flex-row' : 'flex-col')}
    >
      {/* First pane */}
      <div
        style={{
          [isHorizontal ? 'width' : 'height']: `${splitRatio}%`,
        }}
        className="overflow-hidden"
      >
        {renderPane(first)}
      </div>

      {/* Resize handle */}
      <div
        ref={resizeRef}
        className={cn(
          'flex items-center justify-center bg-[var(--color-border)] hover:bg-[var(--color-accent-primary)]/50 transition-colors',
          isHorizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'
        )}
      >
        {isHorizontal ? (
          <GripVertical className="h-4 w-4 text-[var(--color-text-muted)]" />
        ) : (
          <GripHorizontal className="h-4 w-4 text-[var(--color-text-muted)]" />
        )}
      </div>

      {/* Second pane */}
      <div
        style={{
          [isHorizontal ? 'width' : 'height']: `${100 - splitRatio}%`,
        }}
        className="overflow-hidden"
      >
        {renderPane(second)}
      </div>
    </div>
  );
}

export function EditorPaneManager({
  layout,
  panes,
  focusedPaneId,
  onLayoutChange,
  onFocusPane,
  onTabSelect,
  onTabClose,
  onContentChange,
  className = '',
}: EditorPaneManagerProps) {
  const updateSplitRatio = useCallback(
    (path: string[], ratio: number) => {
      const updateLayout = (current: PaneLayout, remainingPath: string[]): PaneLayout => {
        if (remainingPath.length === 0) {
          return { ...current, splitRatio: ratio };
        }

        const [next, ...rest] = remainingPath;
        if (current.type === 'split') {
          if (next === 'first' && current.first) {
            return { ...current, first: updateLayout(current.first, rest) };
          } else if (next === 'second' && current.second) {
            return { ...current, second: updateLayout(current.second, rest) };
          }
        }
        return current;
      };

      onLayoutChange(updateLayout(layout, path));
    },
    [layout, onLayoutChange]
  );

  const renderPane = useCallback(
    (paneLayout: PaneLayout, path: string[] = []): React.ReactNode => {
      if (paneLayout.type === 'leaf' && paneLayout.paneId) {
        const paneState = panes[paneLayout.paneId] || { tabs: [] };
        return (
          <EditorPane
            paneId={paneLayout.paneId}
            tabs={paneState.tabs}
            activeTabPath={paneState.activeTabPath}
            onTabSelect={onTabSelect}
            onTabClose={onTabClose}
            onContentChange={onContentChange}
            isFocused={focusedPaneId === paneLayout.paneId}
            onFocus={onFocusPane}
          />
        );
      }

      if (paneLayout.type === 'split' && paneLayout.first && paneLayout.second && paneLayout.direction) {
        return (
          <SplitPane
            direction={paneLayout.direction}
            first={paneLayout.first}
            second={paneLayout.second}
            splitRatio={paneLayout.splitRatio || 50}
            onSplitRatioChange={(ratio) => updateSplitRatio(path, ratio)}
            renderPane={(childLayout) =>
              renderPane(
                childLayout,
                [...path, childLayout === paneLayout.first ? 'first' : 'second']
              )
            }
          />
        );
      }

      return null;
    },
    [panes, focusedPaneId, onTabSelect, onTabClose, onContentChange, onFocusPane, updateSplitRatio]
  );

  return (
    <div className={cn('h-full overflow-hidden', className)}>
      {renderPane(layout)}
    </div>
  );
}

// Helper to create initial layout
export function createInitialLayout(paneId: string = 'main'): PaneLayout {
  return { type: 'leaf', paneId };
}

// Helper to split a pane
export function splitPane(
  layout: PaneLayout,
  targetPaneId: string,
  direction: SplitDirection,
  newPaneId: string
): PaneLayout {
  if (layout.type === 'leaf' && layout.paneId === targetPaneId) {
    return {
      type: 'split',
      direction,
      first: { type: 'leaf', paneId: targetPaneId },
      second: { type: 'leaf', paneId: newPaneId },
      splitRatio: 50,
    };
  }

  if (layout.type === 'split' && layout.first && layout.second) {
    return {
      ...layout,
      first: splitPane(layout.first, targetPaneId, direction, newPaneId),
      second: splitPane(layout.second, targetPaneId, direction, newPaneId),
    };
  }

  return layout;
}

// Helper to remove a pane
export function removePane(layout: PaneLayout, targetPaneId: string): PaneLayout | null {
  if (layout.type === 'leaf') {
    return layout.paneId === targetPaneId ? null : layout;
  }

  if (layout.type === 'split' && layout.first && layout.second) {
    const newFirst = removePane(layout.first, targetPaneId);
    const newSecond = removePane(layout.second, targetPaneId);

    // If one side was removed, return the other
    if (!newFirst) return newSecond;
    if (!newSecond) return newFirst;

    return { ...layout, first: newFirst, second: newSecond };
  }

  return layout;
}

// Helper to find all pane IDs in a layout
export function getAllPaneIds(layout: PaneLayout): string[] {
  if (layout.type === 'leaf' && layout.paneId) {
    return [layout.paneId];
  }

  if (layout.type === 'split' && layout.first && layout.second) {
    return [...getAllPaneIds(layout.first), ...getAllPaneIds(layout.second)];
  }

  return [];
}
