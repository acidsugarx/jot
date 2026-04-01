# Keyboard Navigation Rework — Unified Focus Engine

**Date:** 2026-03-30
**Status:** In Progress (foundation done, migration pending)
**Goal:** Replace scattered keyboard handling with a single focus engine that makes jot feel like a TUI with mouse fallback.

## Implementation Status

> **Branch:** `vim-motions` (worktree: `.worktrees/focus-engine/`)
> **Last updated:** 2026-03-30

### Done

- **Focus engine core** (`src/lib/focus-engine.ts`) — Zustand store with mode state machine, pane/region/node registry, navigation (j/k/h/l/g/G), pane switching (Tab/Shift+Tab, Ctrl+w), drill-up escape
- **React integration layer**:
  - `src/components/FocusProvider.tsx` — Single keydown listener, mode-specific routing, action dispatch
  - `src/components/focus-engine-context.ts` — React context wrapper
  - `src/components/ModeIndicator.tsx` — `[NORMAL]` / `[INSERT]` / `[/search]` status widget
  - `src/hooks/use-focus-engine.ts` — React hook for engine access
  - `src/hooks/use-focusable.ts` — Component registration hook
- **Root wiring** (`src/main.tsx`) — All 3 windows wrapped in `<FocusProvider>`
- **Capture mode sync** (`src/App.tsx:~408`) — Insert/normal modes sync to focus engine INSERT/NORMAL
- **Tests** — 29 passing across `focus-engine.test.ts`, `use-focusable.test.tsx`, `FocusProvider.test.tsx`, `ModeIndicator.test.tsx`

### Not Done

- **Remove old keyboard handlers** — `addEventListener('keydown')` blocks still present in App.tsx (1), Dashboard.tsx (3), Settings.tsx (2), YougileTaskEditor.tsx (1). These coexist with FocusProvider and may conflict.
- **Remove `useVimBindings`** — `Dashboard.tsx` still imports and calls it. `src/hooks/use-vim-bindings.ts` still exists.
- **Action callbacks** — `window.__jotActions` pattern not implemented. FocusProvider can't dispatch window-specific actions (new task, toggle done, delete, etc.) beyond basic navigation.
- **Visual feedback** — Active pane ring highlights (`ring-1 ring-cyan-500/20`) not added to Dashboard sections.
- **YougileTaskEditor field registration** — `data-editor-field` attributes not added; j/k field navigation not functional.
- **Settings field registration** — `data-field-id` attributes not added; j/k field navigation not functional.

## Problem

Keyboard navigation is spread across 7+ files with duplicated logic, inconsistent behavior, and no unified focus model:

- **Capture bar**: Escape hides the window instead of switching from INSERT to NORMAL mode
- **Dashboard**: Partial keyboard support — h/l column navigation broken in kanban, task editing is mouse-dependent
- **Settings**: Mouse-only, no keyboard navigation for fields or tabs (beyond h/l)
- **Editors**: Once open, keyboard flow breaks — fields require clicking
- **No mode indicator**: User can't tell what mode they're in
- **No pane awareness**: No way to move between sidebar, task list, editor via keyboard

## Approach: Unified Focus Engine

Build a single focus engine that manages a **focus tree** — every focusable element in the app registers itself. One state machine controls modes. One key listener dispatches all actions.

### Focus Tree Model

```
Window (capture | dashboard | settings)
├── Sidebar (filters, source toggle)
├── TaskList / KanbanBoard / Calendar
│   ├── Column 0
│   │   ├── Task 0
│   │   └── Task 1
│   ├── Column 1
│   │   └── Task 0
│   └── ...
└── EditorPane (task fields)
    ├── Title
    ├── Status
    ├── DueDate
    ├── Tags
    └── Notes
```

- Always exactly one **active pane** and one **selected item** within it
- `h/j/k/l` navigates within the current pane
- `Ctrl+w` then `h/j/k/l` (or `Tab`/`Shift+Tab`) switches between panes
- `Escape` drills up: INSERT → NORMAL within pane, or if already NORMAL, deselect/close pane
- Mouse clicks update the same focus engine state — unified behavior

### Three Modes

| Mode | Behavior |
|------|----------|
| **NORMAL** | Vim motions navigate, single-key actions (x, d, e, etc.) |
| **INSERT** | Typing into a field. Only Escape exits. |
| **COMMAND** | `/` opens search. Escape exits. |

A `[NORMAL]` / `[INSERT]` / `[/search]` indicator sits in the bottom-left of each window.

## Keybindings

### Global (NORMAL mode)

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate down/up within current pane |
| `h` / `l` | Navigate left/right (columns in kanban, fields in editor, tabs in settings) |
| `g` | Jump to first item |
| `G` | Jump to last item |
| `Ctrl+w` then `h/j/k/l` | Switch pane in that direction |
| `Tab` / `Shift+Tab` | Next/previous pane (linear order) |
| `Enter` or `e` | Edit selected item (opens editor, enters INSERT) |
| `Escape` | Drill up: deselect → close pane → back to parent |
| `i` | Enter INSERT mode (focus first editable field) |
| `x` | Toggle task done/todo |
| `d` | Delete (shows confirm — `y`/`n` to answer) |
| `n` | New task (opens quick-add, enters INSERT) |
| `/` | Search (enters COMMAND mode) |
| `?` | Toggle hotkey cheat sheet |
| `o` | Open linked note |
| `m` | Move task to next column |
| `r` | Refresh |

### INSERT mode

| Key | Action |
|-----|--------|
| `Escape` | Back to NORMAL (blur field, keep pane) |
| `Tab` / `Shift+Tab` | Next/previous field within editor |
| All other keys | Type normally |

### COMMAND mode (`/` search)

| Key | Action |
|-----|--------|
| `Escape` | Cancel, back to NORMAL |
| `Enter` | Execute search |
| All other keys | Type in search bar |

### Dashboard-specific (NORMAL)

| Key | Action |
|-----|--------|
| `1` / `2` / `3` | Switch to list/kanban/calendar view |
| `s` | Cycle status (local tasks) |
| `a` | Toggle archive |
| `Space` | Toggle source (local/yougile) |

### Capture bar

- `Escape` in NORMAL = hide window (top of focus tree, nowhere to drill up)
- `Escape` in INSERT = switch to NORMAL (does NOT hide — fixes current bug)
- `i` or start typing = enter INSERT mode

### Settings

- `h` / `l` navigates tabs
- `j` / `k` navigates fields within a tab
- `Enter` on a field = INSERT mode for that field
- `Escape` = drill up from field → tab → close window

### Change from current behavior

`Tab` switches panes instead of toggling local/yougile. Source switching moves to `Space`.

## Architecture

### New files

| File | Purpose |
|------|---------|
| `src/lib/focus-engine.ts` | Core: focus tree, mode state machine, pane registry. Pure logic, no React. |
| `src/hooks/use-focus-engine.ts` | React hook wrapping the engine. Provides context, handles key listener. |
| `src/hooks/use-focusable.ts` | Hook for components to register as focusable nodes in the tree. |
| `src/components/ModeIndicator.tsx` | `[NORMAL]` / `[INSERT]` statusline widget. |
| `src/components/FocusProvider.tsx` | React context provider, wraps each window root. |

### Deleted / replaced

| File | Reason |
|------|--------|
| `src/hooks/use-vim-bindings.ts` | Replaced entirely by focus engine (all 427 lines). |
| Inline `addEventListener('keydown')` in App.tsx, Dashboard.tsx, Settings.tsx, YougileTaskEditor.tsx | Key handling moves to the engine. |

### Component registration

```typescript
// A kanban column registers itself
const ref = useFocusable({
  pane: 'task-view',
  region: `column-${columnIndex}`,
  index: columnIndex,
  onSelect: () => selectColumn(columnIndex),
});

// A task card registers itself
const ref = useFocusable({
  pane: 'task-view',
  region: `column-${columnIndex}`,
  index: taskIndex,
  onSelect: () => selectTask(task.id),
  onActivate: () => openEditor(task.id),
});
```

### Focus engine state (Zustand store)

```typescript
{
  mode: 'NORMAL' | 'INSERT' | 'COMMAND',
  activePane: 'sidebar' | 'task-view' | 'editor' | 'quick-add',
  activeRegion: string,    // e.g. 'column-2'
  activeIndex: number,     // item within region
  panes: Map<string, PaneConfig>,
}
```

### Key dispatch flow

1. Single `keydown` listener on `window` (in FocusProvider)
2. Check mode → route to mode-specific handler
3. Handler resolves action → updates focus engine state
4. React re-renders via Zustand store
5. Components read `isSelected` / `isFocused` from the store and style accordingly

### Visual feedback

- Active pane: subtle ring highlight (`ring-1 ring-cyan-500/30`, `dark:ring-cyan-400/20`)
- Selected item: `border-l-cyan-500` (existing treatment)
- Mode indicator: bottom-left, adapts to dark/light theme via Tailwind `dark:` variants

All visual styles use Tailwind `dark:` variants for theme support.

## Edge Cases

| Case | Handling |
|------|----------|
| **Modals/dialogs** (delete confirm, quick-add) | Push temporary pane onto focus stack. Captures all keys. Escape pops it. Mouse outside also pops. |
| **Drag-and-drop** | DnD kit's KeyboardSensor stays — handles own events during drag. Focus engine yields during active drag. |
| **Yougile task editor** | Editor pane registers each field as focusable. `j/k` moves fields in NORMAL, `Enter`/`i` enters INSERT on focused field. |
| **Context menus** | Temporary pane — `j/k` navigates items, `Enter` selects, `Escape` closes. |
| **Search with results** | COMMAND mode shows results, `j/k` navigates, `Enter` selects, `Escape` clears to NORMAL. |
| **Window blur/focus** | Mode resets to NORMAL on window focus (prevents stuck INSERT). |
| **Dark/light mode** | All focus/selection styles use Tailwind `dark:` variants. |

## What stays the same

- All mouse interactions (clicks, double-clicks, context menus, drag-and-drop)
- Global hotkeys (Opt+Space, Cmd+Shift+Space, Cmd+,)
- Task stores — focus engine manages navigation only, not data
- DnD kit keyboard sensor for drag-and-drop

## Migration Order

1. Build focus engine + FocusProvider (no UI changes yet)
2. Wire up ModeIndicator in all 3 windows
3. Migrate Dashboard — biggest surface area, most pain
4. Migrate Capture Bar — fix Escape bug, unify modes
5. Migrate Settings — add full keyboard nav
6. Delete `use-vim-bindings.ts` and all inline handlers
7. Polish visual feedback across dark/light themes
