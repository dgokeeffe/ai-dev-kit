# Task: Frontend bundle optimization - reduce largest chunk to < 150KB gzipped

## Objective

Optimize the frontend bundle size by implementing Vite manual chunking and component-level lazy loading. The current largest chunk (ProjectPage) is 276KB gzipped - target is < 150KB.

## Context

Read these files to understand the current state:
- `client/vite.config.ts` - Vite configuration (needs manualChunks)
- `client/src/App.tsx` - Already has route-level lazy loading
- `client/src/pages/ProjectPage.tsx` - The largest bundle, contains CodeMirror, xterm, etc.
- `client/package.json` - Dependencies to analyze

Also read `progress.txt` if it exists for learnings from previous iterations.

Current bundle analysis:
```
ProjectPage-*.js   951.88 kB │ gzip: 276.51 kB  ← TARGET
index-DKPgnNSJ.js  225.14 kB │ gzip:  72.16 kB
```

Heavy dependencies likely bundled in ProjectPage:
- CodeMirror (~200KB+ raw)
- xterm.js (~100KB+ raw)
- react-markdown + react-syntax-highlighter (~150KB+ raw)

## Technical constraints

- Must maintain TypeScript strict mode
- Must not break existing functionality
- Keep code splitting boundaries logical (editor, terminal, markdown are good boundaries)
- Suspense fallbacks must provide good UX

## Requirements

1. **Configure Vite manual chunks** in `vite.config.ts`:
   - Split CodeMirror into its own chunk (`codemirror` vendor chunk)
   - Split xterm.js into its own chunk (`xterm` vendor chunk)
   - Split react-markdown/syntax-highlighter into own chunk (`markdown` vendor chunk)
   - Keep React and core libs in a shared `vendor` chunk

2. **Component-level lazy loading** if needed after chunking:
   - Lazy load `CodeEditor` component
   - Lazy load terminal components (`ClaudeTerminal`, `OutputPanel`)
   - Add appropriate Suspense boundaries with loading states

3. **Verify no chunk exceeds 150KB gzipped** after optimization

## Gates

Run `bash gates.sh` to verify all criteria. The script checks:

| Gate | Command | Current |
|------|---------|---------|
| Lint-Backend | ruff check server | ✅ |
| Types | npx tsc --noEmit | ✅ |
| Build | npm run build | ✅ |
| MaxChunk<150KB | Parse build output | ❌ 276KB |
| ViteChunks | grep manualChunks | ❌ |
| ReactLazy | grep React.lazy | ✅ |
| Suspense | grep Suspense | ✅ |

## Completion criteria

The task is COMPLETE only when:
- [ ] `bash gates.sh` exits with code 0
- [ ] All chunks are < 150KB gzipped
- [ ] Vite manualChunks configured for heavy deps

Do NOT assess completion subjectively. Run `bash gates.sh` and check the exit code.

## Instructions

1. Read `progress.txt` if it exists
2. Run `bash gates.sh` to see current state
3. Add `manualChunks` configuration to `client/vite.config.ts`:

```typescript
// In vite.config.ts, add to build.rollupOptions:
rollupOptions: {
  output: {
    manualChunks: {
      'vendor-react': ['react', 'react-dom', 'react-router-dom'],
      'vendor-codemirror': [
        'codemirror',
        '@codemirror/autocomplete',
        '@codemirror/commands',
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/lang-javascript',
        '@codemirror/lang-python',
        '@codemirror/lang-json',
        '@codemirror/lang-markdown',
        '@codemirror/lang-sql',
        '@codemirror/lang-yaml',
        '@codemirror/lang-css',
        '@codemirror/lang-html',
        '@codemirror/theme-one-dark',
        '@codemirror/search',
        '@codemirror/lint',
      ],
      'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
      'vendor-markdown': ['react-markdown', 'react-syntax-highlighter', 'remark-gfm'],
    },
  },
}
```

4. Run `npm run build` and check chunk sizes
5. If any chunk still > 150KB, add component-level lazy loading
6. Run `bash gates.sh` to verify all gates pass
7. Append learnings to `progress.txt`

When `bash gates.sh` exits 0, output:
<promise>PERF_COMPLETE</promise>

CRITICAL RULES:
- Only output the promise AFTER `bash gates.sh` exits 0
- Do NOT output the promise based on judgment alone
- If gates fail, fix and re-run until they pass
- If stuck, append blockers to `progress.txt` instead of declaring completion
