export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  category?: string;
  action: () => void;
}

export interface CommandRegistry {
  commands: Map<string, Command>;
  register: (command: Command) => void;
  unregister: (id: string) => void;
  execute: (id: string) => void;
  getAll: () => Command[];
  search: (query: string) => Command[];
}

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, Command>();

  return {
    commands,
    register(command: Command) {
      commands.set(command.id, command);
    },
    unregister(id: string) {
      commands.delete(id);
    },
    execute(id: string) {
      const command = commands.get(id);
      if (command) {
        command.action();
      }
    },
    getAll() {
      return Array.from(commands.values());
    },
    search(query: string) {
      const lowerQuery = query.toLowerCase();
      return Array.from(commands.values()).filter(
        (cmd) =>
          cmd.label.toLowerCase().includes(lowerQuery) ||
          cmd.id.toLowerCase().includes(lowerQuery) ||
          (cmd.category && cmd.category.toLowerCase().includes(lowerQuery))
      );
    },
  };
}

// Default command categories
export const CommandCategories = {
  FILE: 'File',
  EDIT: 'Edit',
  VIEW: 'View',
  TERMINAL: 'Terminal',
  CHAT: 'Chat',
  SEARCH: 'Search',
} as const;

// Helper to format keyboard shortcuts for display
export function formatShortcut(shortcut: string): string {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  return shortcut
    .replace('Cmd', isMac ? '⌘' : 'Ctrl')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .replace('+', ' ');
}
