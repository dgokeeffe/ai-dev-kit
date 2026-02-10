# Task: Polish frontend UX for workshop demo quality

## Objective

Polish the databricks-builder-app frontend to be demo-ready for a workshop. Add a React error boundary so crashes don't blank the screen, add a branded favicon, make the page title dynamic, add copy-to-clipboard on code blocks in chat, and ensure the UI looks professional on projector-sized displays.

## Context

Read these files to understand the current state:
- `client/src/App.tsx` - React app root with routes (no error boundary currently)
- `client/src/components/chat/ChatPanel.tsx` - Chat interface with markdown rendering
- `client/src/components/layout/TopBar.tsx` - Header bar
- `client/src/components/layout/MainLayout.tsx` - Page wrapper
- `client/index.html` - HTML entry point (favicon, page title)
- `client/src/pages/HomePage.tsx` - Homepage
- `client/src/pages/ProjectPage.tsx` - IDE page
- `client/src/styles/globals.css` - Theme CSS variables

Check recent changes:
```bash
git log --oneline -10 -- client/src/
```

## Issues to fix

### 1. CRITICAL: No React error boundary

**Problem**: If any component throws during render, the entire app crashes to a blank white screen. No fallback UI, no recovery option.

**Fix**: Create `client/src/components/ErrorBoundary.tsx` - a class component that catches render errors and shows a friendly error screen with:
- An error icon
- "Something went wrong" message
- The error message (in a muted, smaller font)
- A "Reload" button that calls `window.location.reload()`
- Styled with existing CSS variables to match the app theme

Wrap the app routes in `App.tsx` with this error boundary.

### 2. MEDIUM: Favicon is Vite default

**File**: `client/index.html` line 5

**Problem**: `<link rel="icon" type="image/svg+xml" href="/vite.svg" />` - shows the Vite logo in the browser tab.

**Fix**: Create a Databricks-branded favicon. Create `client/public/favicon.svg` with the Databricks spark mark in red (#FF3621):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="#FF3621">
  <path d="M18 2.4L2.4 11.4V24.6L18 33.6L33.6 24.6V11.4L18 2.4ZM18 6.9L28.8 13.2L18 19.5L7.2 13.2L18 6.9ZM5.4 15.3L16.5 21.75V30.3L5.4 23.7V15.3ZM19.5 30.3V21.75L30.6 15.3V23.7L19.5 30.3Z"/>
</svg>
```

Update `index.html` to reference the new favicon.

### 3. MEDIUM: Page title is static

**File**: `client/index.html` line 7

**Problem**: Title is hardcoded to "Databricks AI Dev Kit". Doesn't change when navigating.

**Fix**:
- Update the static title in `index.html` to "Vibe Coding Workshop" (or use the app title)
- Add `document.title` updates in key pages:
  - `HomePage.tsx`: Set to the app title (e.g., "Vibe Coding Workshop")
  - `ProjectPage.tsx`: Set to `"<project name> - Vibe Coding Workshop"` when project loads

Use a simple `useEffect` in each page - no need for react-helmet.

### 4. MEDIUM: No copy button on code blocks in chat

**File**: `client/src/components/chat/ChatPanel.tsx`

**Problem**: Code blocks in chat responses have no copy-to-clipboard button. Users must manually select and copy code, which is clunky in a demo.

**Fix**: Create a custom `CodeBlock` component that wraps code blocks rendered by `ReactMarkdown`. Add a copy button (use `Copy` and `Check` icons from lucide-react) in the top-right corner of each code block. On click, copy the code to clipboard and show a brief "Copied!" state.

Wire this into the ReactMarkdown `components` prop:
```typescript
<ReactMarkdown
  components={{
    code({ className, children, ...props }) {
      const isInline = !className;
      if (isInline) return <code {...props}>{children}</code>;
      return <CodeBlock language={className?.replace('language-', '')} code={String(children)} />;
    }
  }}
/>
```

### 5. LOW: Console.error calls visible in production

**Problem**: Multiple `console.error()` calls will show in browser dev tools if errors occur during demo.

**Fix**: This is low priority - leave as-is. Console errors are helpful for debugging during the workshop. Do NOT remove them.

### 6. LOW: Responsive layout for projector

**Problem**: Some max-widths are tight for projector displays. However, the IDE layout uses flexbox and adapts well.

**Fix**: This is low priority. The IDE layout (`IDELayout.tsx`) already handles resize well with min/max constraints. No changes needed - just verify it looks good at 1920x1080 and 1280x720.

## Technical constraints

- Do NOT change any backend code (this PROMPT is frontend-only)
- Do NOT add new npm dependencies
- Do NOT change the IDE layout, terminal, git panel, or editor
- Do NOT change the chat streaming logic or agent invoke flow
- Use existing CSS variables and Tailwind classes for styling
- Use lucide-react for any new icons (already a dependency)
- TypeScript strict mode must pass

## Completion criteria

The task is COMPLETE when ALL of these are true:
- [ ] `ErrorBoundary.tsx` exists and catches render errors with a friendly fallback UI
- [ ] `App.tsx` wraps routes with the ErrorBoundary
- [ ] Error boundary shows error message + reload button (not a blank screen)
- [ ] `client/public/favicon.svg` exists with Databricks spark mark
- [ ] `index.html` references the new favicon (not vite.svg)
- [ ] Page title updates to "Vibe Coding Workshop" on HomePage
- [ ] Page title updates to "<project name> - Vibe Coding Workshop" on ProjectPage
- [ ] Code blocks in chat have a copy-to-clipboard button
- [ ] Copy button shows "Copied!" feedback after clicking
- [ ] No TypeScript errors: `cd client && npx tsc --noEmit`
- [ ] ErrorBoundary works (can test by temporarily throwing in a component)

## Instructions

1. Read all context files listed above
2. **Error boundary** (most critical):
   - Create `client/src/components/ErrorBoundary.tsx`
   - Wrap routes in `App.tsx`
3. **Favicon**:
   - Create `client/public/favicon.svg` with Databricks spark SVG
   - Update `index.html`
4. **Dynamic page title**:
   - Update `index.html` default title
   - Add `useEffect` with `document.title` in HomePage and ProjectPage
5. **Code block copy button**:
   - Create a `CodeBlock` component (can be inline in ChatPanel or separate file)
   - Wire into ReactMarkdown's `components` prop
6. Run TypeScript check: `cd client && npx tsc --noEmit`
7. Visually verify in browser if dev servers are running

When ALL completion criteria are verified, output:
<promise>TASK COMPLETE</promise>

IMPORTANT:
- Only output the promise when you have VERIFIED all criteria
- Do NOT output the promise prematurely
- If stuck after multiple attempts, document blockers instead
