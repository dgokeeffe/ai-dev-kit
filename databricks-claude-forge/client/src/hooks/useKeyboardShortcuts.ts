import { useEffect, useCallback } from 'react';

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  // Disable when in input/textarea
  disableInInput?: boolean;
}

export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Check if we're in an input field
      const target = e.target as HTMLElement;
      const isInInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      for (const shortcut of shortcuts) {
        // Skip if in input and shortcut should be disabled
        if (isInInput && shortcut.disableInInput !== false) {
          // Allow specific shortcuts like Cmd+S even in inputs
          const isEssentialShortcut =
            shortcut.key.toLowerCase() === 's' ||
            shortcut.key.toLowerCase() === 'p';
          if (!isEssentialShortcut) continue;
        }

        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatch = !!shortcut.ctrl === e.ctrlKey;
        const metaMatch = !!shortcut.meta === e.metaKey;
        const shiftMatch = !!shortcut.shift === e.shiftKey;
        const altMatch = !!shortcut.alt === e.altKey;

        // On Mac, treat Cmd as the primary modifier
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const primaryModMatch = isMac
          ? (shortcut.meta || shortcut.ctrl) === e.metaKey
          : (shortcut.ctrl || shortcut.meta) === e.ctrlKey;

        if (keyMatch && shiftMatch && altMatch) {
          // Handle primary modifier match
          if (shortcut.meta || shortcut.ctrl) {
            if (primaryModMatch) {
              e.preventDefault();
              shortcut.action();
              return;
            }
          } else if (ctrlMatch && metaMatch) {
            e.preventDefault();
            shortcut.action();
            return;
          }
        }
      }
    },
    [shortcuts]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

// Helper for common modifier combinations
export function cmdOrCtrl(key: string, action: () => void): KeyboardShortcut {
  return { key, meta: true, ctrl: true, action };
}

export function cmdShift(key: string, action: () => void): KeyboardShortcut {
  return { key, meta: true, ctrl: true, shift: true, action };
}
