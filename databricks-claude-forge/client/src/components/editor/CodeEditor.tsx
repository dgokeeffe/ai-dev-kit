import { useEffect, useRef, memo } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';
import { oneDark } from '@codemirror/theme-one-dark';

import { getFileExtension, getLanguageFromExtension } from '@/lib/utils';

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  filePath?: string;
  language?: string;
  readOnly?: boolean;
  className?: string;
}

/**
 * Lazy load CodeMirror language extension based on language name.
 * This reduces initial bundle size by ~100KB+ since language modes are loaded on demand.
 */
async function getLanguageExtension(lang: string) {
  switch (lang) {
    case 'python': {
      const { python } = await import('@codemirror/lang-python');
      return python();
    }
    case 'javascript':
    case 'typescript': {
      const { javascript } = await import('@codemirror/lang-javascript');
      return javascript({ jsx: true, typescript: lang === 'typescript' });
    }
    case 'sql': {
      const { sql } = await import('@codemirror/lang-sql');
      return sql();
    }
    case 'json': {
      const { json } = await import('@codemirror/lang-json');
      return json();
    }
    case 'yaml': {
      const { yaml } = await import('@codemirror/lang-yaml');
      return yaml();
    }
    case 'markdown': {
      const { markdown } = await import('@codemirror/lang-markdown');
      return markdown();
    }
    case 'html': {
      const { html } = await import('@codemirror/lang-html');
      return html();
    }
    case 'css': {
      const { css } = await import('@codemirror/lang-css');
      return css();
    }
    default:
      return [];
  }
}

export const CodeEditor = memo(function CodeEditor({
  value,
  onChange,
  filePath,
  language,
  readOnly = false,
  className = '',
}: CodeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isUpdatingRef = useRef(false);

  // Determine language from file path or explicit prop
  const lang = language || (filePath ? getLanguageFromExtension(getFileExtension(filePath)) : 'text');

  // Create editor on mount with lazy-loaded language support
  useEffect(() => {
    if (!editorRef.current) return;

    let isMounted = true;

    // Async initialization to support lazy language loading
    (async () => {
      // Build base extensions
      const baseExtensions = [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        foldGutter(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        oneDark,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...closeBracketsKeymap,
          ...searchKeymap,
          ...lintKeymap,
          indentWithTab,
        ]),
        // Update listener
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isUpdatingRef.current && onChange) {
            onChange(update.state.doc.toString());
          }
        }),
        // Read-only state
        EditorState.readOnly.of(readOnly),
        // Editor theme customizations
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '13px',
          },
          '.cm-scroller': {
            fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
            overflow: 'auto',
          },
          '.cm-gutters': {
            backgroundColor: 'var(--color-bg-secondary)',
            borderRight: '1px solid var(--color-border)',
          },
        }),
      ];

      // Lazy load language extension
      const langExtension = await getLanguageExtension(lang);
      const extensions = [...baseExtensions, langExtension];

      if (!isMounted) return;

      const state = EditorState.create({
        doc: value,
        extensions,
      });

      const view = new EditorView({
        state,
        parent: editorRef.current!,
      });

      viewRef.current = view;
    })();

    return () => {
      isMounted = false;
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, []); // Only create editor once

  // Update content when value prop changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentContent = view.state.doc.toString();
    if (currentContent !== value) {
      isUpdatingRef.current = true;
      view.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: value,
        },
      });
      isUpdatingRef.current = false;
    }
  }, [value]);

  // Note: Language changes require recreating the editor since
  // dynamic reconfiguration is complex with CodeMirror 6

  return (
    <div
      ref={editorRef}
      className={`h-full w-full overflow-hidden ${className}`}
    />
  );
}, (prevProps, nextProps) => {
  // Only re-render if relevant props changed
  return (
    prevProps.value === nextProps.value &&
    prevProps.filePath === nextProps.filePath &&
    prevProps.readOnly === nextProps.readOnly
  );
});
