import { useEffect, useRef, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface TerminalProps {
  projectId: string;
  className?: string;
}

interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'error';
  content: string;
  timestamp: Date;
}

export function Terminal({ projectId, className = '' }: TerminalProps) {
  const [lines, setLines] = useState<TerminalLine[]>([
    {
      id: 'welcome',
      type: 'output',
      content: `Terminal ready. Working directory: /projects/${projectId}`,
      timestamp: new Date(),
    },
  ]);
  const [currentInput, setCurrentInput] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new lines are added
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  // Focus input on click
  const handleTerminalClick = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const executeCommand = useCallback(async (command: string) => {
    if (!command.trim()) return;

    // Add input line
    const inputLine: TerminalLine = {
      id: `input-${Date.now()}`,
      type: 'input',
      content: `$ ${command}`,
      timestamp: new Date(),
    };
    setLines((prev) => [...prev, inputLine]);

    // Add to history
    setCommandHistory((prev) => [...prev, command]);
    setHistoryIndex(-1);
    setIsExecuting(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/terminal/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });

      const data = await response.json();

      if (data.stdout) {
        const outputLine: TerminalLine = {
          id: `output-${Date.now()}`,
          type: 'output',
          content: data.stdout,
          timestamp: new Date(),
        };
        setLines((prev) => [...prev, outputLine]);
      }

      if (data.stderr) {
        const errorLine: TerminalLine = {
          id: `error-${Date.now()}`,
          type: 'error',
          content: data.stderr,
          timestamp: new Date(),
        };
        setLines((prev) => [...prev, errorLine]);
      }

      if (!response.ok && data.detail) {
        const errorLine: TerminalLine = {
          id: `error-${Date.now()}`,
          type: 'error',
          content: data.detail,
          timestamp: new Date(),
        };
        setLines((prev) => [...prev, errorLine]);
      }
    } catch (error) {
      const errorLine: TerminalLine = {
        id: `error-${Date.now()}`,
        type: 'error',
        content: error instanceof Error ? error.message : 'Command execution failed',
        timestamp: new Date(),
      };
      setLines((prev) => [...prev, errorLine]);
    } finally {
      setIsExecuting(false);
    }
  }, [projectId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isExecuting) {
      executeCommand(currentInput);
      setCurrentInput('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setCurrentInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCurrentInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCurrentInput('');
      }
    } else if (e.key === 'c' && e.ctrlKey) {
      // Clear current input on Ctrl+C
      setCurrentInput('');
      setLines((prev) => [...prev, {
        id: `interrupt-${Date.now()}`,
        type: 'output',
        content: '^C',
        timestamp: new Date(),
      }]);
    } else if (e.key === 'l' && e.ctrlKey) {
      // Clear terminal on Ctrl+L
      e.preventDefault();
      setLines([]);
    }
  }, [currentInput, isExecuting, commandHistory, historyIndex, executeCommand]);

  return (
    <div
      ref={terminalRef}
      className={cn(
        'h-full bg-[#1e1e1e] text-[#d4d4d4] font-mono text-xs overflow-y-auto p-2 cursor-text',
        className
      )}
      onClick={handleTerminalClick}
    >
      {/* Terminal lines */}
      {lines.map((line) => (
        <div
          key={line.id}
          className={cn(
            'whitespace-pre-wrap break-all',
            line.type === 'input' && 'text-[#569cd6]',
            line.type === 'error' && 'text-[#f14c4c]',
            line.type === 'output' && 'text-[#d4d4d4]'
          )}
        >
          {line.content}
        </div>
      ))}

      {/* Input line */}
      <div className="flex items-center">
        <span className="text-[#569cd6] mr-1">$</span>
        <input
          ref={inputRef}
          type="text"
          value={currentInput}
          onChange={(e) => setCurrentInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isExecuting}
          className="flex-1 bg-transparent outline-none text-[#d4d4d4] caret-[#d4d4d4]"
          autoFocus
        />
        {isExecuting && (
          <span className="animate-pulse ml-2 text-[#808080]">Running...</span>
        )}
      </div>
    </div>
  );
}
