# Spec: Yougile Rich-Text Description Editor

**Date:** 2026-04-06
**Status:** Pending Review

## Goal

Replace the plaintext `<textarea>` for Yougile task descriptions with a `contentEditable` WYSIWYG editor that:
1. Renders the **original Yougile HTML** directly (checkboxes, links, lists, tables, code, details/summary)
2. Allows **inline editing** — cursor, type, delete, all work natively
3. Provides a **formatting toolbar** for bold, italic, strikethrough, links, lists, code, checkboxes
4. Supports **keyboard shortcuts** (Ctrl+B/I/K, Ctrl+Shift+C, Tab/Shift+Tab)
5. Handles **smart paste** — auto-links URLs, plain text for everything else
6. **Toggles checkboxes** on click
7. **Opens links** in the system browser on click
8. **Auto-saves** on blur via the Yougile API

## What Exists Now

### Already Implemented (prior work)

| Piece | Location | Status |
|-------|----------|--------|
| `contentEditable` div rendering sanitized Yougile HTML | `YougileTaskEditor.tsx` line ~738 | ✅ Done |
| Checkbox toggle on click | `onClick` handler | ✅ Done |
| Link click → `open_url` IPC → system browser | `onClick` + `src-tauri/src/lib.rs` | ✅ Done |
| Auto-save on blur (`handleDescriptionBlur`) | `useCallback` in editor | ✅ Done |
| External sync (re-render when task changes externally) | `useEffect` watching `task.description` | ✅ Done |
| DOMPurify expanded allowlist | `src/lib/sanitize.ts` | ✅ Done |
| `prose-jot-yougile` CSS for rich content rendering | `src/styles.css` | ✅ Done |
| `open_url` Rust IPC command | `src-tauri/src/lib.rs` | ✅ Done |

### What's Missing

| Piece | Description |
|-------|-------------|
| **Toolbar component** | Row of formatting buttons (Bold, Italic, Strikethrough, Link, Lists, Code, Checkbox) |
| **`execFormatCommand`** | Wrapper around `document.execCommand` that re-focuses the editor first |
| **`insertCheckbox`** | Inserts `<label><input type="checkbox" /> </label>` HTML at cursor |
| **`insertLink`** | Smart link insertion: if selection is URL → wrap; if text → prompt for URL |
| **Keyboard shortcuts** | Ctrl+B/I/K, Ctrl+Shift+C/S, Tab/Shift+Tab, Enter-in-checkbox |
| **Smart paste** | Detect URLs in pasted text → auto-wrap in `<a>` tags; plain text otherwise |
| **Editor CSS** | `prose-jot-editor` class for focus outline, empty placeholder, toolbar styles |

## Architecture

### Data Flow

```
Yougile API (HTML string)
    ↓ sanitizeHtml (DOMPurify)
    ↓ dangerouslySetInnerHTML
contentEditable div (user edits directly in DOM)
    ↓ on blur: el.innerHTML
    ↓ updateTask(id, { description: html })
Yougile API (HTML string saved back)
```

No intermediate plaintext representation. The editor works with HTML round-trip. This preserves all Yougile formatting (checkboxes, links, lists, tables, etc.) that would be lost by stripping to text.

### Toolbar

A row of icon buttons rendered above the contentEditable div. Uses `onMouseDown` with `preventDefault()` to keep focus/selection in the editor. Each button calls `document.execCommand` via `execFormatCommand`.

```
[B] [I] [S] | [🔗] [•] [1.] [</>] [☑]
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+B | Bold |
| Ctrl+I | Italic |
| Ctrl+Shift+S | Strikethrough |
| Ctrl+K | Insert/edit link |
| Ctrl+Shift+C | Insert checkbox |
| Tab | Indent |
| Shift+Tab | Outdent |
| Enter (in checkbox line) | Create new checkbox below |

### Smart Paste

On `paste` event:
1. Get `text/plain` from clipboard
2. If text contains URLs (`https?://...`), wrap them in `<a>` tags via `insertHTML`
3. Otherwise, insert as plain text via `insertText`
4. Always `preventDefault()` to avoid pasting messy HTML from external sources

### Checkbox Behavior

- **Click** on checkbox → toggle `checked` property + `checked` attribute (preserves state in `innerHTML`)
- **Ctrl+Shift+C** → insert `<label><input type="checkbox" /> </label>` at cursor
- **Enter** when cursor is inside a `<label>` containing a checkbox → create new checkbox paragraph below

### Link Behavior

- **Click** on `<a>` → `open_url` IPC (opens in system browser, not editable)
- **Ctrl+K** with text selected → prompt for URL, wrap with `createLink`
- **Ctrl+K** with URL selected → auto-wrap as link
- **Paste** containing URLs → auto-linked

### Save Behavior

On `blur`:
1. Read `descEditorRef.current.innerHTML`
2. Compare with `task.description` (trim both)
3. If different → `updateTask(task.id, { description: newHtml || undefined })`
4. Update local `descHtml` state

### External Sync

On `task.description` change (from another client or window):
1. If editor is **not focused** → update `innerHTML` with sanitized new HTML
2. If editor **is focused** → don't overwrite (user is editing)

## Components

### `ToolbarBtn`

Tiny inline component:
```typescript
function ToolbarBtn({ icon, title, onMouseDown }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  onMouseDown: (e: React.MouseEvent) => void;
})
```

- Renders a `<button>` with the icon, tooltip via `title`
- `onMouseDown` with `e.preventDefault()` to prevent focus steal from contentEditable

### `YougileEditorField` (existing, unchanged)

Wraps the toolbar + editor div as field index 1 for the focus engine. Already exists.

## CSS Classes

| Class | Purpose |
|-------|---------|
| `prose-jot-editor` | Focus outline, border-radius, transition |
| `prose-jot-editor:empty::before` | Placeholder text when editor is empty |
| `prose-jot-yougile` | Rich content rendering (checkboxes, links, tables, etc.) — already exists |
| `yougile-desc-toolbar` | Toolbar container styles |

Both `prose-jot-yougile` and `prose-jot-editor` are applied to the same contentEditable div.

## What Is Not Changed

- `TaskEditorPane` (local tasks) — separate component, uses its own `<textarea>`
- Chat messages — already using `prose-jot-yougile` for rich rendering
- `sanitizeHtml` — already expanded with checkbox/link/details support
- `open_url` IPC — already implemented in Rust
- Focus engine integration — `YougileEditorField` already wraps the description at index 1
- Checklist editor (the separate Yougile checklists section below description) — different feature, not touched

## Files Affected

- `src/components/YougileTaskEditor.tsx` — add `ToolbarBtn`, formatting helpers, keyboard shortcuts, smart paste, replace description JSX
- `src/styles.css` — add `prose-jot-editor` styles

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `document.execCommand` is deprecated | It still works in all browsers and Tauri's WebView. If removed later, switch to `Selection`/`Range` API or a library like TipTap |
| Pasted HTML from clipboard could be messy | Always `preventDefault` and insert as plain text or auto-linked text |
| Checkbox state not preserved in `innerHTML` | Explicitly toggle both `.checked` property and `checked` attribute on click |
| `contentEditable` produces inconsistent HTML across platforms | Sanitize on save; don't over-format. Yougile's API is forgiving |
