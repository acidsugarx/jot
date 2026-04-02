# YougileTaskEditor Full hjkl Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all editable fields in `YougileTaskEditor` (Column, Completed, Deadline, Color, Assigned, Stickers, Checklist items) navigable and operable via the existing hjkl focus engine.

**Architecture:** Three-layer change: (1) engine gets a new `onEnter` callback so `Enter` and `i` can do different things on the same node; (2) `useFocusable` passes `onEnter` through to the engine; (3) `YougileTaskEditor` splits its grouped field block into individual `YougileEditorField` wrappers and adds full checklist inline editing.

**Tech Stack:** TypeScript, React, Zustand (vanilla store), Vitest

---

## File Map

| File | Change |
|------|--------|
| `src/lib/focus-engine.ts` | Add `onEnter` to `FocusNode`; split `Enter` from `e` in `dispatchFocusKey` |
| `src/lib/__tests__/focus-engine.test.ts` | Add tests for `onEnter` dispatch |
| `src/hooks/use-focusable.ts` | Add `onEnter` to `UseFocusableOptions`; pass to `registerNode` |
| `src/components/YougileTaskEditor.tsx` | Split fields 2-5, wrap Assigned (6), wrap Stickers (7+S), add checklist focus nodes with inline edit/toggle/add |

---

## Task 1: Add `onEnter` to FocusNode and split Enter dispatch

**Files:**
- Modify: `src/lib/focus-engine.ts`
- Test: `src/lib/__tests__/focus-engine.test.ts`

### Background

`FocusNode` currently has `onSelect` and `onActivate`. Both `Enter` and `i` call `activateSelection()` → `node.onActivate()`. We need `Enter` to call a separate `node.onEnter()` for checklist toggle, while `i` keeps calling `onActivate` for edit.

- [ ] **Step 1: Write failing tests for `onEnter` dispatch**

Add to `src/lib/__tests__/focus-engine.test.ts`:

```typescript
describe('dispatchFocusKey onEnter', () => {
  let engine: ReturnType<typeof createFocusEngine>;

  beforeEach(() => {
    engine = createFocusEngine();
    engine.getState().registerPane('editor', { regions: ['editor'], order: 1 });
    engine.getState().focusPane('editor');
  });

  it('Enter calls onEnter when set, not onActivate', () => {
    const onActivate = vi.fn();
    const onEnter = vi.fn();
    engine.getState().registerNode({
      pane: 'editor', region: 'editor', index: 0, id: 'field-0',
      onActivate, onEnter,
    });

    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    dispatchFocusKey(engine, event);

    expect(onEnter).toHaveBeenCalledOnce();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('Enter falls back to onActivate when onEnter is not set', () => {
    const onActivate = vi.fn();
    engine.getState().registerNode({
      pane: 'editor', region: 'editor', index: 0, id: 'field-0',
      onActivate,
    });

    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    dispatchFocusKey(engine, event);

    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('i still calls onActivate, not onEnter', () => {
    const onActivate = vi.fn();
    const onEnter = vi.fn();
    engine.getState().registerNode({
      pane: 'editor', region: 'editor', index: 0, id: 'field-0',
      onActivate, onEnter,
    });

    const event = new KeyboardEvent('keydown', { key: 'i' });
    dispatchFocusKey(engine, event);

    expect(onActivate).toHaveBeenCalledOnce();
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('e still calls onActivate, not onEnter', () => {
    const onActivate = vi.fn();
    const onEnter = vi.fn();
    engine.getState().registerNode({
      pane: 'editor', region: 'editor', index: 0, id: 'field-0',
      onActivate, onEnter,
    });

    const event = new KeyboardEvent('keydown', { key: 'e' });
    dispatchFocusKey(engine, event);

    expect(onActivate).toHaveBeenCalledOnce();
    expect(onEnter).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/__tests__/focus-engine.test.ts
```

Expected: 4 new tests fail — `onEnter` property doesn't exist on `FocusNode` yet.

- [ ] **Step 3: Add `onEnter` to `FocusNode` interface**

In `src/lib/focus-engine.ts`, update the `FocusNode` interface (around line 11):

```typescript
export interface FocusNode {
  pane: string;
  region: string;
  index: number;
  id: string;
  onSelect?: () => void;
  onActivate?: () => void;
  onEnter?: () => void;
}
```

- [ ] **Step 4: Split `Enter` from `e` in `dispatchFocusKey`**

In `src/lib/focus-engine.ts`, find the `switch (event.key)` block in `dispatchFocusKey` (around line 474). Replace the combined `Enter`/`e` case:

```typescript
// BEFORE:
case 'Enter':
case 'e':
  event.preventDefault();
  state.activateSelection();
  actions.onOpenItem?.();
  return { handled: true };
```

With two separate cases:

```typescript
case 'Enter': {
  event.preventDefault();
  const list = getActiveList(state);
  const activeNode = list[state.activeIndex];
  if (activeNode?.onEnter) {
    activeNode.onEnter();
  } else {
    state.activateSelection();
    actions.onOpenItem?.();
  }
  return { handled: true };
}
case 'e':
  event.preventDefault();
  state.activateSelection();
  actions.onOpenItem?.();
  return { handled: true };
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/focus-engine.test.ts
```

Expected: all tests pass including the 4 new ones.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/focus-engine.ts src/lib/__tests__/focus-engine.test.ts
git commit -m "feat: add onEnter callback to FocusNode, split Enter from e in dispatch"
```

---

## Task 2: Pass `onEnter` through `useFocusable`

**Files:**
- Modify: `src/hooks/use-focusable.ts`

- [ ] **Step 1: Add `onEnter` to `UseFocusableOptions`**

In `src/hooks/use-focusable.ts`, update the interface (around line 6):

```typescript
export interface UseFocusableOptions {
  pane: string;
  region: string;
  index: number;
  id: string;
  onSelect?: () => void;
  onActivate?: () => void;
  onEnter?: () => void;
  disabled?: boolean;
}
```

- [ ] **Step 2: Add `onEnter` ref and pass to `registerNode`**

In the `useFocusable` function body, after `onActivateRef` (around line 35), add:

```typescript
const onEnterRef = useRef(options.onEnter);
onEnterRef.current = options.onEnter;
```

Then in the `registerNode` call inside `useEffect` (around line 54), add the `onEnter` field:

```typescript
engine.getState().registerNode({
  pane: options.pane,
  region: options.region,
  index: options.index,
  id: options.id,
  onSelect: () => onSelectRef.current?.(),
  onActivate: () => onActivateRef.current?.(),
  onEnter: () => onEnterRef.current?.(),
});
```

- [ ] **Step 3: Typecheck and run tests**

```bash
npm run typecheck && npx vitest run src/lib/__tests__/focus-engine.test.ts
```

Expected: no errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-focusable.ts
git commit -m "feat: pass onEnter through useFocusable to focus engine"
```

---

## Task 3: Split Column / Completed / Deadline / Color into separate focusable rows

**Files:**
- Modify: `src/components/YougileTaskEditor.tsx`

### Background

Currently indices 2–5 are all inside one `<YougileEditorField index={2}>`. We split them into four separate `YougileEditorField` components. A ref is needed for the deadline date input.

- [ ] **Step 1: Add deadline input ref**

`YougileTaskEditor` already has `columnSelectRef`. Add a ref for the deadline date input. Find where refs are declared (around line 262):

```typescript
const columnSelectRef = useRef<HTMLSelectElement>(null);
const deadlineInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 2: Replace the single grouped `YougileEditorField index={2}` with four separate fields**

Find the JSX block starting with `{/* Fields */}` and `<YougileEditorField index={2}` (around line 687). Replace the entire block (through the closing `</YougileEditorField>` at line ~810) with:

```tsx
{/* Fields */}
<div className="border-b border-zinc-800/30">
  {/* [2] Column */}
  <YougileEditorField index={2} onActivate={() => columnSelectRef.current?.focus()}>
    {(isSelected) => (
      <div className={`flex h-9 items-center justify-between px-4 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Column
        </span>
        <div className="flex items-center gap-1">
          <select
            ref={columnSelectRef}
            data-field="column"
            value={columnId}
            onChange={(e) => handleColumnChange(e.target.value)}
            className="bg-transparent text-right text-sm text-zinc-300 focus:outline-none cursor-pointer"
          >
            {columns.map((col) => (
              <option key={col.id} value={col.id}>{col.title}</option>
            ))}
            {!currentColumn && columnId && (
              <option value={columnId}>{columnId}</option>
            )}
          </select>
          <ChevronDown className="h-3 w-3 text-zinc-600 pointer-events-none" />
        </div>
      </div>
    )}
  </YougileEditorField>

  {/* [3] Completed */}
  <YougileEditorField
    index={3}
    onActivate={() => void updateTask(task.id, { completed: !task.completed })}
    onEnter={() => void updateTask(task.id, { completed: !task.completed })}
  >
    {(isSelected) => (
      <div className={`flex h-9 items-center justify-between px-4 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Completed
        </span>
        <button
          type="button"
          onClick={() => void updateTask(task.id, { completed: !task.completed })}
          className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          {task.completed ? (
            <CheckSquare className="h-3.5 w-3.5 text-cyan-400" />
          ) : (
            <Square className="h-3.5 w-3.5 text-zinc-600" />
          )}
          <span className="font-mono text-[10px] text-zinc-500">
            {task.completed ? 'Yes' : 'No'}
          </span>
        </button>
      </div>
    )}
  </YougileEditorField>

  {/* [4] Deadline */}
  <YougileEditorField
    index={4}
    onActivate={() => {
      if (deadlineValue) {
        deadlineInputRef.current?.focus();
      } else {
        const today = new Date().toISOString().split('T')[0] ?? '';
        handleDeadlineChange(today);
        requestAnimationFrame(() => deadlineInputRef.current?.focus());
      }
    }}
  >
    {(isSelected) => (
      <div className={`flex h-9 items-center justify-between px-4 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Deadline
        </span>
        <div className="flex items-center gap-1.5">
          {deadlineValue ? (
            <div className="flex items-center gap-1">
              <input
                ref={deadlineInputRef}
                type="date"
                value={deadlineValue}
                onChange={(e) => handleDeadlineChange(e.target.value)}
                className="bg-transparent font-mono text-sm text-zinc-400 focus:outline-none cursor-pointer [color-scheme:dark]"
              />
              <button
                type="button"
                onClick={handleClearDeadline}
                className="rounded p-0.5 text-zinc-700 hover:text-zinc-400 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                const today = new Date().toISOString().split('T')[0] ?? '';
                handleDeadlineChange(today);
              }}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
            >
              <Calendar className="h-3 w-3" />
              <span className="font-mono text-xs">Set date</span>
            </button>
          )}
        </div>
      </div>
    )}
  </YougileEditorField>

  {/* [5] Color */}
  <YougileEditorField index={5} onActivate={() => setShowColorPicker(true)}>
    {(isSelected) => (
      <div className={`flex h-9 items-center justify-between px-4 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Color
        </span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowColorPicker(!showColorPicker)}
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: getYougileTaskColorValue(colorOption.value) ?? '#7B869E' }}
            />
            <span className="font-mono text-[10px]">{colorOption.label}</span>
          </button>
          {showColorPicker && (
            <div className="absolute right-0 top-full z-10 mt-1 flex flex-wrap gap-1 rounded-md border border-zinc-700 bg-[#1a1a1a] p-2 shadow-xl w-[140px]">
              {YOUGILE_TASK_COLOR_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  title={opt.label}
                  onClick={() => handleColorChange(opt.value)}
                  className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
                    color === opt.value ? 'ring-2 ring-white/40 ring-offset-1 ring-offset-[#1a1a1a]' : ''
                  }`}
                  style={{ backgroundColor: opt.hex }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    )}
  </YougileEditorField>
</div>
```

Note: the `onEnter` prop on `YougileEditorField` isn't wired yet — that's done in Task 2 (`useFocusable` already passes it through). The `YougileEditorField` component itself needs to accept and forward `onEnter` to `useFocusable`. Update the `YougileEditorField` component definition (around line 15):

```typescript
function YougileEditorField({ index, onActivate, onEnter, children }: {
  index: number;
  onActivate?: () => void;
  onEnter?: () => void;
  children: (isSelected: boolean) => ReactNode;
}) {
  const { ref, isSelected } = useFocusable<HTMLDivElement>({
    pane: 'editor',
    region: 'editor',
    index,
    id: `yougile-field-${index}`,
    onActivate: () => {
      onActivate?.();
      focusEngine.getState().setMode('INSERT');
    },
    onEnter,
  });

  return (
    <div
      ref={(node) => { (ref as React.MutableRefObject<HTMLDivElement | null>).current = node; }}
    >
      {children(isSelected)}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/YougileTaskEditor.tsx
git commit -m "feat: split Column/Completed/Deadline/Color into separate focusable fields (indices 2-5)"
```

---

## Task 4: Wrap Assigned section in focusable field (index 6)

**Files:**
- Modify: `src/components/YougileTaskEditor.tsx`

- [ ] **Step 1: Wrap the Assigned section**

Find the `{/* Assigned Users */}` block (around line 812). It currently starts with:

```tsx
{(users.length > 0 || assignedUserIds.length > 0) && (
  <div className="border-b border-zinc-800/30 px-4 py-3">
```

Wrap the entire section's outer `<div>` in a `YougileEditorField`:

```tsx
{(users.length > 0 || assignedUserIds.length > 0) && (
  <YougileEditorField index={6} onActivate={() => setShowAssigneePicker(true)}>
    {(isSelected) => (
      <div className={`border-b border-zinc-800/30 px-4 py-3 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Users className="h-3 w-3 text-zinc-600" />
            <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
              Assigned ({assignedUserIds.length})
            </span>
          </div>
          {users.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAssigneePicker((open) => !open)}
              className="rounded px-1.5 py-0.5 font-mono text-[10px] text-zinc-700 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
            >
              {showAssigneePicker ? 'Done' : 'Edit'}
            </button>
          )}
        </div>
        {/* rest of existing assigned content unchanged */}
        {assignedUserIds.length > 0 ? (
          <div className="flex flex-col gap-1">
            {assignedUserIds.map((userId) => {
              const user = users.find((u) => u.id === userId);
              return (
                <div
                  key={userId}
                  className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1"
                >
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-700 font-mono text-[9px] text-zinc-400">
                    {user?.realName?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-400">
                    {user?.realName ?? user?.email ?? userId}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded border border-dashed border-zinc-800 px-2 py-2 font-mono text-[10px] text-zinc-700">
            No assignees
          </div>
        )}
        {showAssigneePicker && users.length > 0 && (
          <div className="mt-2 flex flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-900/40 p-1">
            {users.map((user) => {
              const isAssigned = assignedUserIds.includes(user.id);
              const label = user.realName ?? user.email ?? user.id;
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => handleToggleAssignee(user.id)}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                    isAssigned ? 'bg-cyan-500/10 text-zinc-200' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                  }`}
                >
                  {isAssigned ? (
                    <CheckSquare className="h-3 w-3 shrink-0 text-cyan-400" />
                  ) : (
                    <Square className="h-3 w-3 shrink-0 text-zinc-700" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    )}
  </YougileEditorField>
)}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/YougileTaskEditor.tsx
git commit -m "feat: wrap Assigned section as focusable field (index 6)"
```

---

## Task 5: Add per-sticker refs and wrap each sticker as a focusable field (index 7+)

**Files:**
- Modify: `src/components/YougileTaskEditor.tsx`

### Background

`stickerDefinitions` is a computed array. Each sticker gets index `7 + stickerIndex`. A `Map<string, HTMLElement | null>` ref stores one ref per sticker id so `onActivate` can focus the right input/select.

- [ ] **Step 1: Add sticker element refs map**

After the other refs (around line 264), add:

```typescript
const stickerRefs = useRef<Map<string, HTMLInputElement | HTMLSelectElement | null>>(new Map());
```

- [ ] **Step 2: Replace the Stickers JSX block with wrapped version**

Find the `{/* Stickers / labels */}` block (around line 985). Replace the outer conditional wrapper and section `<div>` with:

```tsx
{/* Stickers / labels */}
{(stickerDefinitions.length > 0 || Object.keys(stickerValues).length > 0) && (
  <div className="border-b border-zinc-800/30 px-4 py-3">
    <div className="mb-2">
      <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
        Stickers
      </span>
    </div>

    {stickerDefinitions.length > 0 && (
      <div className="flex flex-col gap-2">
        {stickerDefinitions.map((sticker, stickerIndex) => {
          const currentValue = stickerValues[sticker.id] ?? '';
          return (
            <YougileEditorField
              key={sticker.id}
              index={7 + stickerIndex}
              onActivate={() => stickerRefs.current.get(sticker.id)?.focus()}
            >
              {(isSelected) => (
                <div className={`flex items-center justify-between gap-3 rounded px-1 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-500">
                    {sticker.name}
                  </span>
                  {sticker.freeText ? (
                    <input
                      ref={(el) => { stickerRefs.current.set(sticker.id, el); }}
                      type="text"
                      value={currentValue}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setStickerValues((current) => {
                          const next = { ...current };
                          if (nextValue.trim()) {
                            next[sticker.id] = nextValue;
                          } else {
                            delete next[sticker.id];
                          }
                          return next;
                        });
                      }}
                      onBlur={(event) => persistStickerValue(sticker.id, event.target.value)}
                      className="w-40 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none placeholder:text-zinc-700"
                      placeholder="Value"
                    />
                  ) : (
                    <select
                      ref={(el) => { stickerRefs.current.set(sticker.id, el); }}
                      value={currentValue}
                      onChange={(event) => persistStickerValue(sticker.id, event.target.value)}
                      className="w-40 bg-transparent text-right text-xs text-zinc-300 focus:outline-none cursor-pointer"
                    >
                      <option value="">Not set</option>
                      <option value="empty">Empty</option>
                      {sticker.states.map((state) => (
                        <option key={state.id} value={state.id}>
                          {state.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </YougileEditorField>
          );
        })}
      </div>
    )}

    {Object.entries(stickerValues).length > 0 && (
      <div className="mt-3 flex flex-wrap gap-1.5">
        {Object.entries(stickerValues).map(([key, value]) => {
          const resolvedState = stickerStateLookup[value];
          const resolvedSticker = stickerDefinitionLookup[key];
          const label = resolvedState
            ? `${resolvedState.stickerName}: ${resolvedState.valueName}`
            : resolvedSticker
              ? `${resolvedSticker.name}: ${value}`
              : formatStickerValue(value, key);

          return (
            <span
              key={key}
              className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
            >
              {label}
            </span>
          );
        })}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. Note: `stickerRefs.current.set(sticker.id, el)` works with both `HTMLInputElement | HTMLSelectElement | null` because both have a `focus()` method.

- [ ] **Step 4: Commit**

```bash
git add src/components/YougileTaskEditor.tsx
git commit -m "feat: wrap each sticker as individual focusable field (index 7+S)"
```

---

## Task 6: Checklist items — inline edit, toggle, and add via keyboard

**Files:**
- Modify: `src/components/YougileTaskEditor.tsx`

### Background

The sticker count `S` = `stickerDefinitions.length`. Checklist items start at index `7 + S`. Each item gets a unique index computed as `7 + S + flatItemIndex` where `flatItemIndex` increments across all checklists. Node ids use the format `yougile-checklist-{clIdx}-{itemIdx}` so the `onNewItem` handler can extract `clIdx`.

A local state `editingItemKey: string | null` (format `"clIdx:itemIdx"`) tracks which item shows an `<input>` instead of a `<span>`.

- [ ] **Step 1: Add `editingItemKey` state and `editingItemText` state**

After the `checklists` state (around line 242):

```typescript
const [editingItemKey, setEditingItemKey] = useState<string | null>(null);
const [editingItemText, setEditingItemText] = useState('');
```

- [ ] **Step 2: Add `commitEditingItem` helper**

After `handleClearDeadline` (around line 413), add:

```typescript
const commitEditingItem = useCallback((clIdx: number, itemIdx: number, text: string) => {
  const trimmed = text.trim();
  if (!trimmed) {
    setEditingItemKey(null);
    setEditingItemText('');
    focusEngine.getState().setMode('NORMAL');
    return;
  }
  const updated = checklists.map((cl, ci) => {
    if (ci !== clIdx) return cl;
    return {
      ...cl,
      items: cl.items.map((item, ii) =>
        ii === itemIdx ? { ...item, title: trimmed } : item
      ),
    };
  });
  setChecklists(updated);
  void updateTask(task.id, { checklists: updated });
  setEditingItemKey(null);
  setEditingItemText('');
  focusEngine.getState().setMode('NORMAL');
}, [checklists, task.id, updateTask]);
```

- [ ] **Step 3: Wire `onNewItem` into `window.__jotActions`**

In the existing `useEffect` that sets `window.__jotActions.onEscape` (around line 343), extend it to also set `onNewItem`:

```typescript
useEffect(() => {
  const existing = window.__jotActions;
  window.__jotActions = {
    ...existing,
    onEscape: () => {
      const engineMode = focusEngine.getState().mode;
      if (engineMode === 'INSERT') {
        focusEngine.getState().setMode('NORMAL');
      } else {
        onClose();
      }
    },
    onNewItem: () => {
      const { activePane, activeRegion, activeIndex, nodes } = focusEngine.getState();
      if (!activePane || !activeRegion) return;
      const key = `${activePane}:${activeRegion}`;
      const nodeList = nodes.get(key) ?? [];
      const activeNode = nodeList[activeIndex];
      if (!activeNode?.id.startsWith('yougile-checklist-')) return;

      // Parse clIdx from id: "yougile-checklist-{clIdx}-{itemIdx}"
      const parts = activeNode.id.split('-');
      const clIdx = parseInt(parts[2] ?? '', 10);
      if (isNaN(clIdx) || clIdx < 0 || clIdx >= checklists.length) return;

      const targetChecklist = checklists[clIdx];
      if (!targetChecklist) return;

      const newItemIdx = targetChecklist.items.length;
      const updated = checklists.map((cl, ci) => {
        if (ci !== clIdx) return cl;
        return { ...cl, items: [...cl.items, { title: '', completed: false }] };
      });
      setChecklists(updated);
      void updateTask(task.id, { checklists: updated });

      const newKey = `${clIdx}:${newItemIdx}`;
      setEditingItemKey(newKey);
      setEditingItemText('');
      focusEngine.getState().setMode('INSERT');
    },
  };
  return () => {
    if (existing) {
      window.__jotActions = existing;
    } else if (window.__jotActions) {
      delete window.__jotActions;
    }
  };
}, [onClose, checklists, task.id, updateTask]);
```

- [ ] **Step 4: Replace the Checklists JSX block with focusable version**

Find the `{/* Checklists */}` block (around line 884). Replace the entire block with:

```tsx
{/* Checklists */}
{checklists.length > 0 && (
  <div className="border-b border-zinc-800/30 px-4 py-3">
    <div className="mb-2 flex items-center justify-between">
      <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
        Checklists
      </span>
      {totalChecklistItems > 0 && (
        <span className="font-mono text-[10px] text-zinc-600">
          {completedChecklistItems}/{totalChecklistItems}
        </span>
      )}
    </div>
    {totalChecklistItems > 0 && (
      <div className="mb-3 h-0.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-cyan-500/60 transition-all"
          style={{ width: `${(completedChecklistItems / totalChecklistItems) * 100}%` }}
        />
      </div>
    )}
    <div className="flex flex-col gap-3">
      {(() => {
        let flatIndex = 0;
        return checklists.map((cl, clIdx) => (
          <div key={clIdx}>
            {cl.title && (
              <div className="mb-1.5 font-mono text-[10px] font-medium text-zinc-500">
                {cl.title}
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              {cl.items.map((item, itemIdx) => {
                const nodeIndex = 7 + stickerDefinitions.length + flatIndex;
                const nodeId = `yougile-checklist-${clIdx}-${itemIdx}`;
                const itemKey = `${clIdx}:${itemIdx}`;
                const isEditing = editingItemKey === itemKey;
                flatIndex++;
                return (
                  <YougileEditorField
                    key={nodeId}
                    index={nodeIndex}
                    onActivate={() => {
                      setEditingItemKey(itemKey);
                      setEditingItemText(item.title);
                      focusEngine.getState().setMode('INSERT');
                    }}
                    onEnter={() => {
                      const updated = checklists.map((c, ci) => {
                        if (ci !== clIdx) return c;
                        return {
                          ...c,
                          items: c.items.map((it, ii) =>
                            ii !== itemIdx ? it : { ...it, completed: !it.completed }
                          ),
                        };
                      });
                      setChecklists(updated);
                      void updateTask(task.id, { checklists: updated });
                    }}
                  >
                    {(isSelected) => (
                      <div className={`flex items-start gap-2 rounded px-1 py-0.5 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = checklists.map((c, ci) => {
                              if (ci !== clIdx) return c;
                              return {
                                ...c,
                                items: c.items.map((it, ii) =>
                                  ii !== itemIdx ? it : { ...it, completed: !it.completed }
                                ),
                              };
                            });
                            setChecklists(updated);
                            void updateTask(task.id, { checklists: updated });
                          }}
                          className="mt-px shrink-0"
                        >
                          {item.completed ? (
                            <CheckSquare className="h-3 w-3 text-cyan-400" />
                          ) : (
                            <Square className="h-3 w-3 text-zinc-600" />
                          )}
                        </button>
                        {isEditing ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingItemText}
                            onChange={(e) => setEditingItemText(e.target.value)}
                            onBlur={() => commitEditingItem(clIdx, itemIdx, editingItemText)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitEditingItem(clIdx, itemIdx, editingItemText);
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditingItemKey(null);
                                setEditingItemText('');
                                focusEngine.getState().setMode('NORMAL');
                              }
                            }}
                            className="flex-1 bg-transparent text-xs leading-relaxed text-zinc-300 outline-none"
                          />
                        ) : (
                          <span className={`text-xs leading-relaxed ${
                            item.completed ? 'text-zinc-600 line-through' : 'text-zinc-400'
                          }`}>
                            {item.title || <span className="text-zinc-700 italic">empty</span>}
                          </span>
                        )}
                      </div>
                    )}
                  </YougileEditorField>
                );
              })}
            </div>
          </div>
        ));
      })()}
    </div>
  </div>
)}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/YougileTaskEditor.tsx
git commit -m "feat: checklist items focusable with inline edit (i), toggle (Enter), add (n)"
```

---

## Task 7: Smoke test the full flow

- [ ] **Step 1: Run full CI check**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: all pass with no errors.

- [ ] **Step 2: Manual verification checklist**

Start the app with `npm run tauri dev` (or `npm run dev` for frontend-only). Open a Yougile task editor and verify:

| Action | Expected |
|--------|----------|
| `j/k` from Description | navigates to Column (index 2), Completed (3), Deadline (4), Color (5) |
| `i` on Column | focuses the column `<select>` |
| `i` on Completed | toggles completed immediately |
| `Enter` on Completed | toggles completed |
| `i` on Deadline (empty) | sets today's date and focuses date input |
| `i` on Deadline (set) | focuses the date input |
| `i` on Color | opens color picker |
| `j` from Color | navigates to Assigned (index 6) if present |
| `i` on Assigned | opens assignee picker |
| `j` through Stickers | each sticker is its own focusable row |
| `i` on a sticker | focuses that sticker's input/select |
| `j` through Checklist items | each item is its own focusable row |
| `i` on a checklist item | shows inline input, engine enters INSERT |
| Escape in checklist input | cancels edit, returns to NORMAL |
| Enter in checklist input | saves edit, returns to NORMAL |
| `Enter` on checklist item (NORMAL) | toggles completed |
| `n` on checklist item | appends empty item to that checklist, opens edit |

- [ ] **Step 3: Final commit if any cleanup was needed**

```bash
git add -p
git commit -m "fix: keyboard nav edge cases found during smoke test"
```
