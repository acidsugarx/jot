# Spec: Full hjkl Navigation for YougileTaskEditor

**Date:** 2026-04-02
**Status:** Approved

## Goal

All editable fields in `YougileTaskEditor` — Column, Completed, Deadline, Color, Assigned, Stickers, and Checklist items — must be reachable and operable via the existing hjkl focus engine. Currently only Title (index 0) and Description (index 1) are registered as focusable nodes; the rest are mouse-only.

## Field Index Map

Fields are registered in render order. Conditional sections (Assigned, Stickers, Checklists) auto-unregister when not rendered, so the engine's node list is always accurate with no gaps.

| Index | Field | `i` action | `Enter` action | `n` / `a` action |
|-------|-------|-----------|---------------|-----------------|
| 0 | Title | focus textarea | — | — |
| 1 | Description | focus textarea | — | — |
| 2 | Column | focus `<select>` | — | — |
| 3 | Completed | toggle immediately | toggle immediately | — |
| 4 | Deadline | set today if empty; else focus date input | — | — |
| 5 | Color | `setShowColorPicker(true)` | — | — |
| 6 | Assigned | `setShowAssigneePicker(true)` | — | — |
| 7..7+S | Stickers (one per sticker, in definition order) | focus that sticker's input/select | — | — |
| 7+S..end | Checklist items (flat across all checklists, in order) | edit title inline | toggle completed | add new item to that checklist |

`S` = number of sticker definitions currently rendered.

## Engine Change: Separate `Enter` from `i`

### Problem

Currently `Enter` and `i` both call `activateSelection()` → `node.onActivate()`. To support "i = edit text, Enter = toggle" on checklist items without breaking existing nodes, we need a distinct callback for `Enter`.

### Change

Add optional `onEnter?: () => void` to `FocusNode` interface in `focus-engine.ts`.

In `dispatchFocusKey`:
- `i` → `activateSelection()` (calls `node.onActivate()`) — unchanged
- `Enter` → call `node.onEnter?.()` if set on the active node; else fall back to `activateSelection()` (preserves existing behavior for all non-checklist nodes)
- `e` → `activateSelection()` + `actions.onOpenItem?.()` — unchanged

`useFocusable` and `UseFocusableOptions` are updated to accept and pass through `onEnter`.

## Checklist Inline Editing

Checklist items are currently read-only `<span>` elements. A local `editingItemKey` state (`"clIdx:itemIdx"` string or `null`) tracks which item is in edit mode.

**Edit flow (`i`):**
1. `onActivate` fires → set `editingItemKey` to `"clIdx:itemIdx"`, set engine mode to INSERT
2. Render an `<input>` instead of `<span>`, auto-focus it
3. On blur or `Enter` keydown in the input → trim value, call `updateTask` with updated checklists, clear `editingItemKey`, set engine mode to NORMAL

**Toggle flow (`Enter` in NORMAL mode):**
1. `onEnter` fires → flip `item.completed`, call `updateTask` immediately
2. Stay in NORMAL mode

**Add item flow (`n` or `a` in NORMAL mode):**
- These keys call `actions.onNewItem?.()` from `dispatchFocusKey`
- `YougileTaskEditor` sets `window.__jotActions.onNewItem` to a handler that:
  1. Identifies which checklist the currently focused checklist node belongs to (by `clIdx` encoded in the node id)
  2. Appends a new empty item to that checklist
  3. Calls `updateTask` with the updated checklists
  4. Sets `editingItemKey` to the new item's key and focuses its input

If the active node is not a checklist item, `onNewItem` is a no-op.

## Splitting the Grouped Fields Block

The current `YougileEditorField index={2}` wraps Column + Completed + Deadline + Color as one block. This block is split into four separate `YougileEditorField` components (indices 2–5), each wrapping its own row `<div>`. The outer border grouping `<div>` is kept for visual consistency but no longer tied to a single focusable node.

## Assigned and Stickers Wrapping

- The Assigned section `<div>` is wrapped in a `YougileEditorField` at index 6. `onActivate` calls `setShowAssigneePicker(true)`.
- Each sticker in `stickerDefinitions` gets its own `YougileEditorField` at index `7 + stickerIndex`. `onActivate` focuses that sticker's `<input>` or `<select>` via a per-sticker ref.

## Visual Selection Indicator

All new `YougileEditorField` wrappers use the existing `isSelected` pattern:
`ring-1 ring-inset ring-cyan-500/20` applied to the row `<div>` when selected.

## What Is Not Changed

- `TaskEditorPane` (local tasks) — separate component, not touched
- Chat section — not a data field, remains mouse-only
- Time Tracking — read-only display, not registered as focusable
- Checklists count/progress header — not focusable, only items are
- Engine key bindings other than the `Enter` / `onEnter` split

## Files Affected

- `src/lib/focus-engine.ts` — add `onEnter` to `FocusNode`, update `dispatchFocusKey`
- `src/hooks/use-focusable.ts` — add `onEnter` to `UseFocusableOptions`, pass through to `registerNode`
- `src/components/YougileTaskEditor.tsx` — split fields, wrap sections, add checklist edit/toggle/add logic
