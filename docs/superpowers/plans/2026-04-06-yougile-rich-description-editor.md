# Yougile Description Rich-Text Editor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plaintext `<textarea>` for Yougile task descriptions with a `contentEditable` WYSIWYG editor that renders original Yougile HTML, allows inline editing with formatting controls, and preserves rich content (checkboxes, links, lists, tables, code, details/summary).

**Architecture:** Two-layer change: (1) a `ToolbarBtn` component + formatting helpers (`execFormatCommand`, `insertCheckbox`, `insertLink`) added inside the existing `YougileTaskEditor`; (2) the description field's `<textarea>` / preview-toggle replaced with a single `contentEditable` div + inline toolbar.

**Tech Stack:** TypeScript, React, contentEditable API, `document.execCommand`, DOMPurify

---

## File Map

| File | Change |
|------|--------|
| `src/components/YougileTaskEditor.tsx` | Add `ToolbarBtn` component, formatting helpers, smart paste, keyboard shortcuts; replace description textarea/preview with contentEditable + toolbar |
| `src/lib/sanitize.ts` | Expand DOMPurify allowlist (already done: `details`, `summary`, `hr`, `s`, `strike`, `del`, `input`, `label`, attrs `type`, `checked`, `disabled`, `open`) |
| `src/styles.css` | Add `prose-jot-editor` styles (toolbar, focus outline, placeholder) |
| `src-tauri/src/lib.rs` | `open_url` IPC command for opening links in browser (already done) |

---

## Task 1: Add `ToolbarBtn` component

**Files:**
- Modify: `src/components/YougileTaskEditor.tsx`

### Background

A tiny inline component rendering a formatting button. Uses `onMouseDown` (not `onClick`) so the editor doesn't lose focus/selection.

- [ ] **Step 1: Add lucide icon imports**

Update the lucide import line to include the new icons:

```typescript
import {
  X, Calendar, Clock, CheckSquare, Square, Users, ChevronDown, MessageCircle,
  Send, Loader2, ZoomIn, Paperclip, Image as ImageIcon,
  Bold, Italic, Strikethrough, Link, List, ListOrdered, Code,
} from 'lucide-react';
```

- [ ] **Step 2: Add `ToolbarBtn` component after `YougileEditorField`**

Place it right after the `YougileEditorField` component (around line 42):

```typescript
function ToolbarBtn({ icon: Icon, title, onMouseDown }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onMouseDown(e); }}
      className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

---

## Task 2: Add formatting helper functions

**Files:**
- Modify: `src/components/YougileTaskEditor.tsx`

### Background

Three helper functions + smart paste handler + keyboard shortcut handler. These go inside the `YougileTaskEditor` component, before the JSX return.

- [ ] **Step 1: Add `execFormatCommand`, `insertCheckbox`, `insertLink` callbacks**

Add these after `handleDescriptionBlur` (around line 395):

```typescript
const execFormatCommand = useCallback((command: string, value?: string) => {
  descEditorRef.current?.focus();
  document.execCommand(command, false, value);
}, []);

const insertCheckbox = useCallback(() => {
  descEditorRef.current?.focus();
  document.execCommand(
    'insertHTML',
    false,
    '<label><input type="checkbox" /> </label>&nbsp;'
  );
}, []);

const insertLink = useCallback(() => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {
    // Nothing selected — prompt for URL
    const href = window.prompt('URL:', 'https://');
    if (!href) return;
    descEditorRef.current?.focus();
    document.execCommand('createLink', false, href);
    return;
  }
  const selectedText = sel.toString();
  if (/^https?:\/\//.test(selectedText)) {
    // Selected text is already a URL — wrap in anchor
    document.execCommand('insertHTML', false,
      `<a href="${selectedText}">${selectedText}</a>`);
  } else {
    // Selected text is label — prompt for URL
    const href = window.prompt('URL:', 'https://');
    if (!href) return;
    document.execCommand('createLink', false, href);
  }
}, []);
```

- [ ] **Step 2: Add `handleDescriptionKeyDown` for keyboard shortcuts**

```typescript
const handleDescriptionKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
  const mod = e.ctrlKey || e.metaKey;

  // Ctrl+B bold
  if (mod && e.key === 'b') { e.preventDefault(); execFormatCommand('bold'); return; }
  // Ctrl+I italic
  if (mod && e.key === 'i') { e.preventDefault(); execFormatCommand('italic'); return; }
  // Ctrl+Shift+S strikethrough
  if (mod && e.shiftKey && e.key === 'S') { e.preventDefault(); execFormatCommand('strikeThrough'); return; }
  // Ctrl+K insert link
  if (mod && e.key === 'k') { e.preventDefault(); insertLink(); return; }
  // Ctrl+Shift+C insert checkbox
  if (mod && e.shiftKey && e.key === 'C') { e.preventDefault(); insertCheckbox(); return; }
  // Tab indent
  if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); execFormatCommand('indent'); return; }
  // Shift+Tab outdent
  if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); execFormatCommand('outdent'); return; }

  // Enter inside a checkbox line → create new checkbox
  if (e.key === 'Enter' && !e.shiftKey) {
    const parent = (e.target as HTMLElement).closest?.('label');
    if (parent?.querySelector('input[type="checkbox"]')) {
      e.preventDefault();
      document.execCommand(
        'insertHTML', false,
        '</p><p><label><input type="checkbox" /> </label>&nbsp;'
      );
    }
  }
}, [execFormatCommand, insertCheckbox, insertLink]);
```

- [ ] **Step 3: Add `handleSmartPaste` for URL auto-linking**

```typescript
const handleSmartPaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
  const text = e.clipboardData?.getData('text/plain');
  if (!text) return;

  e.preventDefault();

  // Auto-detect URLs in pasted text → wrap in <a> tags
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  const hasUrls = urlRegex.test(text);

  if (hasUrls) {
    // Reset regex state (lastIndex)
    const matches = text.match(/(https?:\/\/[^\s<]+)/g) ?? [];
    let result = text;
    for (const url of matches) {
      const escaped = url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      result = result.replace(url, `<a href="${escaped}">${escaped}</a>`);
    }
    document.execCommand('insertHTML', false, result);
  } else {
    // Plain text — insert as-is (escapes handled by browser)
    document.execCommand('insertText', false, text);
  }
}, []);
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

---

## Task 3: Replace description JSX with toolbar + contentEditable

**Files:**
- Modify: `src/components/YougileTaskEditor.tsx`

### Background

Replace the entire description section (currently a simple label + contentEditable div with basic handlers) with: toolbar row + enhanced contentEditable div wired to the new handlers.

- [ ] **Step 1: Replace the description JSX block**

Find the `{/* Description */}` block (the `YougileEditorField index={1}` section). Replace its inner content with:

```tsx
<YougileEditorField index={1} onActivate={() => descEditorRef.current?.focus()}>
  {(isSelected) => (
    <div className={`border-b border-zinc-800/30 px-4 py-3 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Description
        </span>
        {/* Formatting toolbar */}
        <div className="flex items-center gap-px rounded-md border border-zinc-800/50 bg-zinc-900/40 px-1.5 py-0.5">
          <ToolbarBtn icon={Bold} title="Bold (Ctrl+B)" onMouseDown={() => execFormatCommand('bold')} />
          <ToolbarBtn icon={Italic} title="Italic (Ctrl+I)" onMouseDown={() => execFormatCommand('italic')} />
          <ToolbarBtn icon={Strikethrough} title="Strikethrough (Ctrl+Shift+S)" onMouseDown={() => execFormatCommand('strikeThrough')} />
          <div className="mx-0.5 h-3 w-px border-l border-zinc-800/40" />
          <ToolbarBtn icon={Link} title="Link (Ctrl+K)" onMouseDown={() => insertLink()} />
          <ToolbarBtn icon={List} title="Bullet list" onMouseDown={() => execFormatCommand('insertUnorderedList')} />
          <ToolbarBtn icon={ListOrdered} title="Numbered list" onMouseDown={() => execFormatCommand('insertOrderedList')} />
          <ToolbarBtn icon={Code} title="Code (Ctrl+Shift+`)" onMouseDown={() => execFormatCommand('formatBlock', 'pre')} />
          <ToolbarBtn icon={CheckSquare} title="Checkbox (Ctrl+Shift+C)" onMouseDown={() => insertCheckbox()} />
        </div>
      </div>
      <div
        ref={descEditorRef}
        contentEditable
        suppressContentEditableWarning
        className="prose-jot prose-jot-editor min-h-[2.5rem] cursor-text outline-none"
        dangerouslySetInnerHTML={{ __html: descSanitizedHtml || '<p><br></p>' }}
        onBlur={handleDescriptionBlur}
        onKeyDown={handleDescriptionKeyDown}
        onPaste={handleSmartPaste}
        onClick={(e) => {
          // Checkbox toggle
          const checkbox = (e.target as HTMLElement).closest('input[type="checkbox"]');
          if (checkbox instanceof HTMLInputElement) {
            e.preventDefault();
            checkbox.checked = !checkbox.checked;
            checkbox.toggleAttribute('checked');
            return;
          }
          // Link → open in browser
          const anchor = (e.target as HTMLElement).closest('a');
          if (anchor?.href) {
            e.preventDefault();
            void invoke('open_url', { url: anchor.href });
          }
        }}
        data-placeholder="Add a description…"
        spellCheck={false}
      />
    </div>
  )}
</YougileEditorField>
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

---

## Task 4: Add editor CSS styles

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add `prose-jot-editor` and toolbar styles**

Append after the existing `prose-jot-yougile` light theme block:

```css
/* ── Description editor (contentEditable) ──────────────────────────────── */

.prose-jot-editor {
  border-radius: 0.25rem;
  transition: box-shadow 0.15s;
}
.prose-jot-editor:focus {
  box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.1);
}

/* Placeholder when empty */
.prose-jot-editor:empty::before {
  content: attr(data-placeholder);
  color: #52525b;
  pointer-events: none;
  display: block;
}

/* Checkboxes inside editor are interactive */
.prose-jot-editor input[type="checkbox"] {
  pointer-events: auto;
}

/* Toolbar hover feedback */
.yougile-desc-toolbar button:focus-visible {
  outline: 1px solid rgba(34, 211, 238, 0.3);
  outline-offset: -1px;
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

---

## Task 5: Remove dead code

**Files:**
- Modify: `src/components/YougileTaskEditor.tsx`

- [ ] **Step 1: Remove unused imports**

Remove `Eye` and `PenLine` from lucide imports if still present (they were for the removed preview/edit toggle).

- [ ] **Step 2: Remove `descPreview` state if it exists**

Search for any remaining references to `descPreview`, `descPreviewHtml`, `descRawHtml`, `description` (the old plaintext state), `descRef` (the old textarea ref). Remove them all. The only description-related state should be `descHtml` and `descEditorRef`.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

---

## Task 6: Smoke test

- [ ] **Step 1: Full CI check**

```bash
npm run typecheck && npm run lint && npm run test -- --run
```

- [ ] **Step 2: Manual verification checklist**

Start app with `npm run tauri dev`. Open a Yougile task with a rich description (checkboxes, links, formatting).

| Action | Expected |
|--------|----------|
| Description renders | Shows original Yougile HTML — checkboxes, links, bold, lists, tables |
| Click checkbox | Toggles checked/unchecked |
| Click link | Opens in system browser |
| Click description text | Cursor appears, editable |
| Type text | Inserts at cursor |
| **B** toolbar button | Selected text becomes bold |
| **I** toolbar button | Selected text becomes italic |
| **S** toolbar button | Selected text gets strikethrough |
| **Link** toolbar button (with text selected) | Prompts for URL, wraps selection |
| **Link** toolbar button (with URL selected) | Auto-wraps selected URL as link |
| **List** toolbar button | Wraps selection in `<ul>` |
| **Ordered list** button | Wraps selection in `<ol>` |
| **Code** button | Wraps in `<pre>` |
| **Checkbox** button | Inserts checkbox at cursor |
| Ctrl+B / Ctrl+I / Ctrl+K / Ctrl+Shift+C | Same as toolbar buttons |
| Tab / Shift+Tab | Indent / outdent |
| Enter inside checkbox line | Creates new checkbox below |
| Paste URL text | Auto-links URLs |
| Paste plain text | Inserts as plain text |
| Blur (click outside) | Saves description to Yougile API |

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: rich-text description editor with toolbar, shortcuts, and smart paste"
```
