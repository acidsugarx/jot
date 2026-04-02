# Keyboard Navigation Rework — Unified Focus Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scattered keyboard handling across 7+ files with a single focus engine that makes jot feel like a TUI with mouse fallback.

**Architecture:** A Zustand-based focus engine manages a tree of focusable panes/regions/items. A single `keydown` listener dispatches to mode-specific handlers (NORMAL/INSERT/COMMAND). Components register via `useFocusable()` hook. Mouse clicks update the same focus state.

**Tech Stack:** React 18, Zustand 5, TypeScript 5.9, Vitest, @testing-library/react, Tailwind CSS 3

**Spec:** `docs/superpowers/specs/2026-03-30-keyboard-navigation-rework-design.md`

## Progress Tracker

> **Branch:** `vim-motions` (worktree: `.worktrees/focus-engine/`)
> **Last updated:** 2026-03-30

| Task | Status | Notes |
|------|--------|-------|
| 1. Focus Engine Core | ✅ Done | `focus-engine.ts` + tests — 29 tests passing |
| 2. Navigation Logic Tests | ✅ Done | Covered in Task 1 test file |
| 3. useFocusable Hook | ✅ Done | `use-focusable.ts` + `use-focus-engine.ts` |
| 4. ModeIndicator Component | ✅ Done | Renders NORMAL/INSERT/COMMAND |
| 5. FocusProvider — Key Dispatch | ✅ Done | Single keydown listener, mode routing |
| 6. Wire into Window Roots | ✅ Done | `main.tsx` wraps all windows in `<FocusProvider>` |
| 7. Migrate Dashboard | ✅ Done | `useVimBindings` removed, pane registration + `__jotActions` added |
| 8. Wire Kanban Components | ✅ Done | `KanbanTaskCard` uses `useFocusable`, selection ring styling |
| 9. Migrate Capture Bar | ✅ Done | Inline handlers replaced, j/k/g/G local nav, Escape → hide |
| 10. Migrate Settings | ✅ Done | Inline handlers replaced, tab switching via focus engine |
| 11. Migrate YougileTaskEditor | ✅ Done | Escape handler via `__jotActions`, preserves Dashboard actions |
| 12. Delete use-vim-bindings.ts | ✅ Done | Deleted (-427 lines) |
| 13. Visual Polish | ✅ Done | Pane ring highlights (`ring-cyan-500/20`) on sidebar/task-view/editor |
| 14. Final CI | ✅ Done | typecheck + lint + 29/29 tests pass |

### Complete

All tasks done. Merged to `vim-motions` branch.

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/lib/focus-engine.ts` | Pure-logic focus tree, mode state machine, key dispatch. Zustand store. No React imports. |
| `src/hooks/use-focusable.ts` | React hook — registers a DOM element as a focusable node, returns ref + selection state. |
| `src/components/FocusProvider.tsx` | Mounts the single `keydown` listener, provides engine context, renders `ModeIndicator`. |
| `src/components/ModeIndicator.tsx` | `[NORMAL]` / `[INSERT]` / `[/search]` widget. Positioned bottom-left of each window. |
| `src/lib/__tests__/focus-engine.test.ts` | Unit tests for the focus engine (pure logic, no DOM). |
| `src/hooks/__tests__/use-focusable.test.tsx` | Integration tests for the hook + engine. |
| `src/components/__tests__/FocusProvider.test.tsx` | Integration tests for key dispatch. |
| `src/components/__tests__/ModeIndicator.test.tsx` | Render tests for mode display. |

### Modified files

| File | Change |
|------|--------|
| `src/main.tsx` | Wrap each window root in `<FocusProvider>` |
| `src/Dashboard.tsx` | Remove inline keydown handlers, wire up `useFocusable` on sidebar/task-view/editor panes |
| `src/App.tsx` | Remove inline keydown handlers, wire up focus engine for capture bar modes |
| `src/Settings.tsx` | Remove inline keydown handler, wire up focus engine for tab/field navigation |
| `src/components/KanbanBoard.tsx` | Wire up column/task registration via `useFocusable` |
| `src/components/KanbanTaskCard.tsx` | Register as focusable node, read selection state from engine |
| `src/components/YougileTaskEditor.tsx` | Register editor fields as focusable, remove inline Escape handler |

### Deleted files

| File | Reason |
|------|--------|
| `src/hooks/use-vim-bindings.ts` | Fully replaced by focus engine |

---

## Task 1: Focus Engine Core — Types & State

**Files:**
- Create: `src/lib/focus-engine.ts`
- Create: `src/lib/__tests__/focus-engine.test.ts`

- [ ] **Step 1: Write failing tests for focus engine types and store creation**

```typescript
// src/lib/__tests__/focus-engine.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createFocusEngine } from '../focus-engine';

describe('FocusEngine', () => {
  let engine: ReturnType<typeof createFocusEngine>;

  beforeEach(() => {
    engine = createFocusEngine();
  });

  it('initializes with NORMAL mode and no active pane', () => {
    const state = engine.getState();
    expect(state.mode).toBe('NORMAL');
    expect(state.activePane).toBeNull();
    expect(state.activeRegion).toBeNull();
    expect(state.activeIndex).toBe(0);
  });

  it('registers a pane', () => {
    engine.getState().registerPane('task-view', {
      regions: ['column-0', 'column-1'],
      order: 1,
    });
    expect(engine.getState().panes.has('task-view')).toBe(true);
  });

  it('unregisters a pane', () => {
    engine.getState().registerPane('task-view', { regions: ['column-0'], order: 1 });
    engine.getState().unregisterPane('task-view');
    expect(engine.getState().panes.has('task-view')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/focus-engine.test.ts`
Expected: FAIL — `createFocusEngine` not found

- [ ] **Step 3: Implement focus engine types and store**

```typescript
// src/lib/focus-engine.ts
import { createStore } from 'zustand/vanilla';

export type FocusMode = 'NORMAL' | 'INSERT' | 'COMMAND';

export interface PaneConfig {
  regions: string[];
  order: number; // for Tab cycling between panes
}

export interface FocusNode {
  pane: string;
  region: string;
  index: number;
  id: string; // unique node id (e.g. task id)
  onSelect?: () => void;
  onActivate?: () => void; // Enter/e in NORMAL mode
}

export interface FocusState {
  mode: FocusMode;
  activePane: string | null;
  activeRegion: string | null;
  activeIndex: number;
  panes: Map<string, PaneConfig>;
  nodes: Map<string, FocusNode[]>; // keyed by `${pane}:${region}`
  pendingPaneSwitch: boolean; // true after Ctrl+w, waiting for direction

  // Actions
  registerPane: (id: string, config: PaneConfig) => void;
  unregisterPane: (id: string) => void;
  registerNode: (node: FocusNode) => void;
  unregisterNode: (pane: string, region: string, id: string) => void;
  clearNodes: (pane: string, region?: string) => void;

  setMode: (mode: FocusMode) => void;
  focusPane: (paneId: string) => void;
  focusRegion: (region: string) => void;
  focusIndex: (index: number) => void;
  focusNode: (pane: string, region: string, index: number) => void;

  // Navigation
  moveUp: () => void;
  moveDown: () => void;
  moveLeft: () => void;
  moveRight: () => void;
  jumpFirst: () => void;
  jumpLast: () => void;
  nextPane: () => void;
  prevPane: () => void;

  // Escape drill-up
  drillUp: () => void;

  // Reset on window focus
  resetMode: () => void;
}

function getRegionKey(pane: string, region: string) {
  return `${pane}:${region}`;
}

function getSortedPanes(panes: Map<string, PaneConfig>): string[] {
  return [...panes.entries()]
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([id]) => id);
}

export function createFocusEngine() {
  return createStore<FocusState>((set, get) => ({
    mode: 'NORMAL',
    activePane: null,
    activeRegion: null,
    activeIndex: 0,
    panes: new Map(),
    nodes: new Map(),
    pendingPaneSwitch: false,

    registerPane: (id, config) => set((s) => {
      const panes = new Map(s.panes);
      panes.set(id, config);
      // Auto-focus first pane if none active
      const activePane = s.activePane ?? id;
      const activeRegion = activePane === id && !s.activeRegion && config.regions.length > 0
        ? config.regions[0]!
        : s.activeRegion;
      return { panes, activePane, activeRegion };
    }),

    unregisterPane: (id) => set((s) => {
      const panes = new Map(s.panes);
      panes.delete(id);
      // Clear nodes for this pane
      const nodes = new Map(s.nodes);
      for (const key of nodes.keys()) {
        if (key.startsWith(`${id}:`)) nodes.delete(key);
      }
      const isActive = s.activePane === id;
      return {
        panes,
        nodes,
        activePane: isActive ? null : s.activePane,
        activeRegion: isActive ? null : s.activeRegion,
        activeIndex: isActive ? 0 : s.activeIndex,
      };
    }),

    registerNode: (node) => set((s) => {
      const key = getRegionKey(node.pane, node.region);
      const nodes = new Map(s.nodes);
      const list = [...(nodes.get(key) ?? [])];
      // Replace existing node with same id, or append
      const existingIdx = list.findIndex((n) => n.id === node.id);
      if (existingIdx >= 0) {
        list[existingIdx] = node;
      } else {
        list.push(node);
      }
      // Keep sorted by index
      list.sort((a, b) => a.index - b.index);
      nodes.set(key, list);
      return { nodes };
    }),

    unregisterNode: (pane, region, id) => set((s) => {
      const key = getRegionKey(pane, region);
      const nodes = new Map(s.nodes);
      const list = (nodes.get(key) ?? []).filter((n) => n.id !== id);
      if (list.length === 0) {
        nodes.delete(key);
      } else {
        nodes.set(key, list);
      }
      return { nodes };
    }),

    clearNodes: (pane, region) => set((s) => {
      const nodes = new Map(s.nodes);
      if (region) {
        nodes.delete(getRegionKey(pane, region));
      } else {
        for (const key of nodes.keys()) {
          if (key.startsWith(`${pane}:`)) nodes.delete(key);
        }
      }
      return { nodes };
    }),

    setMode: (mode) => set({ mode }),

    focusPane: (paneId) => {
      const s = get();
      const config = s.panes.get(paneId);
      if (!config) return;
      const region = config.regions[0] ?? null;
      set({ activePane: paneId, activeRegion: region, activeIndex: 0 });
    },

    focusRegion: (region) => set({ activeRegion: region, activeIndex: 0 }),

    focusIndex: (index) => set({ activeIndex: index }),

    focusNode: (pane, region, index) => set({
      activePane: pane,
      activeRegion: region,
      activeIndex: index,
    }),

    moveDown: () => {
      const s = get();
      if (!s.activePane || !s.activeRegion) return;
      const key = getRegionKey(s.activePane, s.activeRegion);
      const list = s.nodes.get(key) ?? [];
      if (list.length === 0) return;
      const next = Math.min(s.activeIndex + 1, list.length - 1);
      set({ activeIndex: next });
      list[next]?.onSelect?.();
    },

    moveUp: () => {
      const s = get();
      if (!s.activePane || !s.activeRegion) return;
      const key = getRegionKey(s.activePane, s.activeRegion);
      const list = s.nodes.get(key) ?? [];
      if (list.length === 0) return;
      const prev = Math.max(s.activeIndex - 1, 0);
      set({ activeIndex: prev });
      list[prev]?.onSelect?.();
    },

    moveLeft: () => {
      const s = get();
      if (!s.activePane || !s.activeRegion) return;
      const config = s.panes.get(s.activePane);
      if (!config) return;
      const regionIdx = config.regions.indexOf(s.activeRegion);
      if (regionIdx <= 0) return;
      const newRegion = config.regions[regionIdx - 1]!;
      // Try to keep similar index in new region
      const key = getRegionKey(s.activePane, newRegion);
      const list = s.nodes.get(key) ?? [];
      const newIndex = Math.min(s.activeIndex, Math.max(0, list.length - 1));
      set({ activeRegion: newRegion, activeIndex: newIndex });
      list[newIndex]?.onSelect?.();
    },

    moveRight: () => {
      const s = get();
      if (!s.activePane || !s.activeRegion) return;
      const config = s.panes.get(s.activePane);
      if (!config) return;
      const regionIdx = config.regions.indexOf(s.activeRegion);
      if (regionIdx < 0 || regionIdx >= config.regions.length - 1) return;
      const newRegion = config.regions[regionIdx + 1]!;
      const key = getRegionKey(s.activePane, newRegion);
      const list = s.nodes.get(key) ?? [];
      const newIndex = Math.min(s.activeIndex, Math.max(0, list.length - 1));
      set({ activeRegion: newRegion, activeIndex: newIndex });
      list[newIndex]?.onSelect?.();
    },

    jumpFirst: () => {
      const s = get();
      if (!s.activePane || !s.activeRegion) return;
      const key = getRegionKey(s.activePane, s.activeRegion);
      const list = s.nodes.get(key) ?? [];
      if (list.length === 0) return;
      set({ activeIndex: 0 });
      list[0]?.onSelect?.();
    },

    jumpLast: () => {
      const s = get();
      if (!s.activePane || !s.activeRegion) return;
      const key = getRegionKey(s.activePane, s.activeRegion);
      const list = s.nodes.get(key) ?? [];
      if (list.length === 0) return;
      const last = list.length - 1;
      set({ activeIndex: last });
      list[last]?.onSelect?.();
    },

    nextPane: () => {
      const s = get();
      const sorted = getSortedPanes(s.panes);
      if (sorted.length === 0) return;
      const idx = s.activePane ? sorted.indexOf(s.activePane) : -1;
      const next = sorted[(idx + 1) % sorted.length]!;
      get().focusPane(next);
    },

    prevPane: () => {
      const s = get();
      const sorted = getSortedPanes(s.panes);
      if (sorted.length === 0) return;
      const idx = s.activePane ? sorted.indexOf(s.activePane) : 0;
      const prev = sorted[(idx - 1 + sorted.length) % sorted.length]!;
      get().focusPane(prev);
    },

    drillUp: () => {
      const s = get();
      if (s.mode === 'INSERT' || s.mode === 'COMMAND') {
        set({ mode: 'NORMAL' });
        return;
      }
      // NORMAL mode: deselect or close
      if (s.activePane) {
        set({ activePane: null, activeRegion: null, activeIndex: 0 });
      }
    },

    resetMode: () => set({ mode: 'NORMAL', pendingPaneSwitch: false }),
  }));
}

// Singleton for the app
export const focusEngine = createFocusEngine();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/focus-engine.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/focus-engine.ts src/lib/__tests__/focus-engine.test.ts
git commit -m "feat: add focus engine core — types, store, pane registration"
```

---

## Task 2: Focus Engine Navigation Logic Tests

**Files:**
- Modify: `src/lib/__tests__/focus-engine.test.ts`

- [ ] **Step 1: Write failing tests for navigation**

```typescript
// Append to src/lib/__tests__/focus-engine.test.ts

describe('FocusEngine navigation', () => {
  let engine: ReturnType<typeof createFocusEngine>;

  beforeEach(() => {
    engine = createFocusEngine();
    engine.getState().registerPane('task-view', {
      regions: ['column-0', 'column-1', 'column-2'],
      order: 1,
    });
    // Register 3 nodes in column-0
    engine.getState().registerNode({ pane: 'task-view', region: 'column-0', index: 0, id: 'task-1' });
    engine.getState().registerNode({ pane: 'task-view', region: 'column-0', index: 1, id: 'task-2' });
    engine.getState().registerNode({ pane: 'task-view', region: 'column-0', index: 2, id: 'task-3' });
    // Register 2 nodes in column-1
    engine.getState().registerNode({ pane: 'task-view', region: 'column-1', index: 0, id: 'task-4' });
    engine.getState().registerNode({ pane: 'task-view', region: 'column-1', index: 1, id: 'task-5' });
    // Focus the pane
    engine.getState().focusPane('task-view');
  });

  it('moveDown increments index within region', () => {
    expect(engine.getState().activeIndex).toBe(0);
    engine.getState().moveDown();
    expect(engine.getState().activeIndex).toBe(1);
  });

  it('moveDown clamps at last item', () => {
    engine.getState().moveDown();
    engine.getState().moveDown();
    engine.getState().moveDown(); // should clamp
    expect(engine.getState().activeIndex).toBe(2);
  });

  it('moveUp decrements index within region', () => {
    engine.getState().focusIndex(2);
    engine.getState().moveUp();
    expect(engine.getState().activeIndex).toBe(1);
  });

  it('moveUp clamps at first item', () => {
    engine.getState().moveUp();
    expect(engine.getState().activeIndex).toBe(0);
  });

  it('moveRight moves to next region', () => {
    expect(engine.getState().activeRegion).toBe('column-0');
    engine.getState().moveRight();
    expect(engine.getState().activeRegion).toBe('column-1');
  });

  it('moveLeft moves to previous region', () => {
    engine.getState().focusRegion('column-1');
    engine.getState().moveLeft();
    expect(engine.getState().activeRegion).toBe('column-0');
  });

  it('moveRight preserves index clamped to target region length', () => {
    engine.getState().focusIndex(2); // index 2 in column-0 (3 items)
    engine.getState().moveRight(); // column-1 has 2 items
    expect(engine.getState().activeRegion).toBe('column-1');
    expect(engine.getState().activeIndex).toBe(1); // clamped to last
  });

  it('jumpFirst goes to index 0', () => {
    engine.getState().focusIndex(2);
    engine.getState().jumpFirst();
    expect(engine.getState().activeIndex).toBe(0);
  });

  it('jumpLast goes to last index', () => {
    engine.getState().jumpLast();
    expect(engine.getState().activeIndex).toBe(2);
  });
});

describe('FocusEngine pane switching', () => {
  let engine: ReturnType<typeof createFocusEngine>;

  beforeEach(() => {
    engine = createFocusEngine();
    engine.getState().registerPane('sidebar', { regions: ['filters'], order: 0 });
    engine.getState().registerPane('task-view', { regions: ['column-0'], order: 1 });
    engine.getState().registerPane('editor', { regions: ['fields'], order: 2 });
    engine.getState().focusPane('task-view');
  });

  it('nextPane cycles forward', () => {
    engine.getState().nextPane();
    expect(engine.getState().activePane).toBe('editor');
  });

  it('nextPane wraps around', () => {
    engine.getState().focusPane('editor');
    engine.getState().nextPane();
    expect(engine.getState().activePane).toBe('sidebar');
  });

  it('prevPane cycles backward', () => {
    engine.getState().prevPane();
    expect(engine.getState().activePane).toBe('sidebar');
  });
});

describe('FocusEngine drillUp', () => {
  let engine: ReturnType<typeof createFocusEngine>;

  beforeEach(() => {
    engine = createFocusEngine();
    engine.getState().registerPane('task-view', { regions: ['column-0'], order: 1 });
    engine.getState().focusPane('task-view');
  });

  it('drillUp from INSERT returns to NORMAL', () => {
    engine.getState().setMode('INSERT');
    engine.getState().drillUp();
    expect(engine.getState().mode).toBe('NORMAL');
    expect(engine.getState().activePane).toBe('task-view'); // pane stays
  });

  it('drillUp from COMMAND returns to NORMAL', () => {
    engine.getState().setMode('COMMAND');
    engine.getState().drillUp();
    expect(engine.getState().mode).toBe('NORMAL');
  });

  it('drillUp from NORMAL deselects pane', () => {
    engine.getState().drillUp();
    expect(engine.getState().activePane).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/focus-engine.test.ts`
Expected: PASS (all tests — implementation was written in Task 1)

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/focus-engine.test.ts
git commit -m "test: add comprehensive navigation & pane switching tests for focus engine"
```

---

## Task 3: useFocusable Hook

**Files:**
- Create: `src/hooks/use-focusable.ts`
- Create: `src/hooks/__tests__/use-focusable.test.tsx`

- [ ] **Step 1: Write failing test for useFocusable**

```typescript
// src/hooks/__tests__/use-focusable.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFocusable } from '../use-focusable';
import { focusEngine } from '@/lib/focus-engine';

describe('useFocusable', () => {
  beforeEach(() => {
    // Reset engine state
    const s = focusEngine.getState();
    for (const key of s.panes.keys()) s.unregisterPane(key);
    s.resetMode();

    // Register a pane for the test
    focusEngine.getState().registerPane('task-view', {
      regions: ['column-0'],
      order: 1,
    });
    focusEngine.getState().focusPane('task-view');
  });

  it('registers node on mount and unregisters on unmount', () => {
    const { unmount } = renderHook(() =>
      useFocusable({
        pane: 'task-view',
        region: 'column-0',
        index: 0,
        id: 'task-1',
      })
    );

    const key = 'task-view:column-0';
    expect(focusEngine.getState().nodes.get(key)?.length).toBe(1);

    unmount();
    expect(focusEngine.getState().nodes.get(key)).toBeUndefined();
  });

  it('returns isSelected true when node matches active state', () => {
    const { result } = renderHook(() =>
      useFocusable({
        pane: 'task-view',
        region: 'column-0',
        index: 0,
        id: 'task-1',
      })
    );

    expect(result.current.isSelected).toBe(true);
  });

  it('returns isSelected false when index does not match', () => {
    const { result } = renderHook(() =>
      useFocusable({
        pane: 'task-view',
        region: 'column-0',
        index: 1,
        id: 'task-2',
      })
    );

    expect(result.current.isSelected).toBe(false);
  });

  it('returns isPaneFocused true when pane matches', () => {
    const { result } = renderHook(() =>
      useFocusable({
        pane: 'task-view',
        region: 'column-0',
        index: 0,
        id: 'task-1',
      })
    );

    expect(result.current.isPaneFocused).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-focusable.test.tsx`
Expected: FAIL — `use-focusable` not found

- [ ] **Step 3: Implement useFocusable**

```typescript
// src/hooks/use-focusable.ts
import { useEffect, useRef, useCallback } from 'react';
import { useStore } from 'zustand';
import { focusEngine, type FocusNode } from '@/lib/focus-engine';

interface UseFocusableOptions {
  pane: string;
  region: string;
  index: number;
  id: string;
  onSelect?: () => void;
  onActivate?: () => void;
}

export function useFocusable(options: UseFocusableOptions) {
  const { pane, region, index, id, onSelect, onActivate } = options;
  const ref = useRef<HTMLElement>(null);

  // Register/unregister node
  useEffect(() => {
    const node: FocusNode = { pane, region, index, id, onSelect, onActivate };
    focusEngine.getState().registerNode(node);
    return () => {
      focusEngine.getState().unregisterNode(pane, region, id);
    };
  }, [pane, region, index, id, onSelect, onActivate]);

  // Read selection state from engine
  const isSelected = useStore(focusEngine, (s) =>
    s.activePane === pane && s.activeRegion === region && s.activeIndex === index
  );
  const isPaneFocused = useStore(focusEngine, (s) => s.activePane === pane);
  const mode = useStore(focusEngine, (s) => s.mode);

  // Scroll into view when selected
  useEffect(() => {
    if (isSelected && ref.current) {
      requestAnimationFrame(() => {
        ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
  }, [isSelected]);

  // Click handler — focus this node via the engine
  const handleClick = useCallback(() => {
    focusEngine.getState().focusNode(pane, region, index);
    onSelect?.();
  }, [pane, region, index, onSelect]);

  // Double-click — activate (open editor)
  const handleDoubleClick = useCallback(() => {
    focusEngine.getState().focusNode(pane, region, index);
    onActivate?.();
  }, [pane, region, index, onActivate]);

  return {
    ref,
    isSelected,
    isPaneFocused,
    mode,
    handleClick,
    handleDoubleClick,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/use-focusable.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-focusable.ts src/hooks/__tests__/use-focusable.test.tsx
git commit -m "feat: add useFocusable hook for component registration into focus engine"
```

---

## Task 4: ModeIndicator Component

**Files:**
- Create: `src/components/ModeIndicator.tsx`
- Create: `src/components/__tests__/ModeIndicator.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
// src/components/__tests__/ModeIndicator.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModeIndicator } from '../ModeIndicator';
import { focusEngine } from '@/lib/focus-engine';

describe('ModeIndicator', () => {
  beforeEach(() => {
    focusEngine.getState().resetMode();
  });

  it('shows NORMAL mode by default', () => {
    render(<ModeIndicator />);
    expect(screen.getByText('NORMAL')).toBeInTheDocument();
  });

  it('shows INSERT mode when engine is in INSERT', () => {
    focusEngine.getState().setMode('INSERT');
    render(<ModeIndicator />);
    expect(screen.getByText('INSERT')).toBeInTheDocument();
  });

  it('shows search indicator in COMMAND mode', () => {
    focusEngine.getState().setMode('COMMAND');
    render(<ModeIndicator />);
    expect(screen.getByText('/search')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/__tests__/ModeIndicator.test.tsx`
Expected: FAIL — `ModeIndicator` not found

- [ ] **Step 3: Implement ModeIndicator**

```typescript
// src/components/ModeIndicator.tsx
import { useStore } from 'zustand';
import { focusEngine, type FocusMode } from '@/lib/focus-engine';

const modeConfig: Record<FocusMode, { label: string; className: string }> = {
  NORMAL: {
    label: 'NORMAL',
    className: 'bg-cyan-500/20 text-cyan-400 dark:bg-cyan-500/15 dark:text-cyan-300',
  },
  INSERT: {
    label: 'INSERT',
    className: 'bg-green-500/20 text-green-400 dark:bg-green-500/15 dark:text-green-300',
  },
  COMMAND: {
    label: '/search',
    className: 'bg-amber-500/20 text-amber-400 dark:bg-amber-500/15 dark:text-amber-300',
  },
};

export function ModeIndicator() {
  const mode = useStore(focusEngine, (s) => s.mode);
  const config = modeConfig[mode];

  return (
    <div className="fixed bottom-2 left-2 z-50 pointer-events-none">
      <span
        className={`inline-block px-2 py-0.5 rounded font-mono text-xs font-semibold ${config.className}`}
      >
        {config.label}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/__tests__/ModeIndicator.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ModeIndicator.tsx src/components/__tests__/ModeIndicator.test.tsx
git commit -m "feat: add ModeIndicator component showing current vim mode"
```

---

## Task 5: FocusProvider — Key Dispatch

**Files:**
- Create: `src/components/FocusProvider.tsx`
- Create: `src/components/__tests__/FocusProvider.test.tsx`

- [ ] **Step 1: Write failing test for key dispatch**

```typescript
// src/components/__tests__/FocusProvider.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FocusProvider } from '../FocusProvider';
import { focusEngine } from '@/lib/focus-engine';

describe('FocusProvider', () => {
  beforeEach(() => {
    const s = focusEngine.getState();
    for (const key of s.panes.keys()) s.unregisterPane(key);
    s.resetMode();
  });

  it('renders children and ModeIndicator', () => {
    render(
      <FocusProvider windowType="dashboard">
        <div>child content</div>
      </FocusProvider>
    );
    expect(screen.getByText('child content')).toBeInTheDocument();
    expect(screen.getByText('NORMAL')).toBeInTheDocument();
  });

  it('j key calls moveDown in NORMAL mode', async () => {
    focusEngine.getState().registerPane('task-view', { regions: ['list'], order: 0 });
    focusEngine.getState().focusPane('task-view');
    focusEngine.getState().registerNode({ pane: 'task-view', region: 'list', index: 0, id: 't1' });
    focusEngine.getState().registerNode({ pane: 'task-view', region: 'list', index: 1, id: 't2' });

    render(
      <FocusProvider windowType="dashboard">
        <div>content</div>
      </FocusProvider>
    );

    await userEvent.keyboard('j');
    expect(focusEngine.getState().activeIndex).toBe(1);
  });

  it('Escape in INSERT mode switches to NORMAL', async () => {
    focusEngine.getState().setMode('INSERT');

    render(
      <FocusProvider windowType="dashboard">
        <div>content</div>
      </FocusProvider>
    );

    await userEvent.keyboard('{Escape}');
    expect(focusEngine.getState().mode).toBe('NORMAL');
  });

  it('does not handle keys when INPUT is focused', async () => {
    focusEngine.getState().registerPane('task-view', { regions: ['list'], order: 0 });
    focusEngine.getState().focusPane('task-view');
    focusEngine.getState().registerNode({ pane: 'task-view', region: 'list', index: 0, id: 't1' });
    focusEngine.getState().registerNode({ pane: 'task-view', region: 'list', index: 1, id: 't2' });

    render(
      <FocusProvider windowType="dashboard">
        <input data-testid="input" />
      </FocusProvider>
    );

    // Focus the input first, then type
    const input = screen.getByTestId('input');
    input.focus();
    // In INSERT mode, keys should pass through to the input
    focusEngine.getState().setMode('INSERT');
    await userEvent.keyboard('j');
    expect(focusEngine.getState().activeIndex).toBe(0); // not moved
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/__tests__/FocusProvider.test.tsx`
Expected: FAIL — `FocusProvider` not found

- [ ] **Step 3: Implement FocusProvider**

```typescript
// src/components/FocusProvider.tsx
import { useEffect, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { focusEngine } from '@/lib/focus-engine';
import { ModeIndicator } from './ModeIndicator';

export type WindowType = 'main' | 'dashboard' | 'settings';

interface FocusProviderProps {
  windowType: WindowType;
  children: ReactNode;
  /** Action callbacks the window provides to the key handler */
  actions?: {
    onToggleSource?: () => void;
    onSwitchView?: (view: string) => void;
    onNewTask?: () => void;
    onToggleDone?: (taskId: string) => void;
    onDelete?: (taskId: string) => void;
    onEdit?: (taskId: string) => void;
    onOpenNote?: (taskId: string) => void;
    onMoveTask?: (taskId: string) => void;
    onCycleStatus?: (taskId: string) => void;
    onToggleArchive?: (taskId: string) => void;
    onRefresh?: () => void;
    onToggleHelp?: () => void;
    onSearch?: () => void;
    onHideWindow?: () => void;
    onCloseWindow?: () => void;
    /** Returns the active selected node ID, used for action dispatch */
    getSelectedNodeId?: () => string | null;
  };
}

function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function FocusProvider({ windowType, children, actions }: FocusProviderProps) {
  const mode = useStore(focusEngine, (s) => s.mode);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const engine = focusEngine.getState();

      // In INSERT mode, only handle Escape and Tab
      if (engine.mode === 'INSERT') {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          // Blur any focused input
          if (isEditableElement(document.activeElement)) {
            (document.activeElement as HTMLElement).blur();
          }
          engine.setMode('NORMAL');
          return;
        }
        // Tab/Shift+Tab in INSERT moves between fields — let browser handle or custom
        // All other keys pass through to the focused input
        return;
      }

      // In COMMAND mode, only handle Escape and Enter
      if (engine.mode === 'COMMAND') {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (isEditableElement(document.activeElement)) {
            (document.activeElement as HTMLElement).blur();
          }
          engine.setMode('NORMAL');
          return;
        }
        // Enter and other keys pass through to search input
        return;
      }

      // NORMAL mode — but skip if user is somehow in an input
      if (isEditableElement(document.activeElement)) return;

      // Ctrl+w — pane switch prefix
      if (e.key === 'w' && e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        focusEngine.setState({ pendingPaneSwitch: true });
        return;
      }

      // If pending pane switch, next h/j/k/l selects pane direction
      if (engine.pendingPaneSwitch) {
        focusEngine.setState({ pendingPaneSwitch: false });
        e.preventDefault();
        switch (e.key) {
          case 'h': case 'ArrowLeft':
            engine.prevPane(); break;
          case 'l': case 'ArrowRight':
            engine.nextPane(); break;
          case 'j': case 'ArrowDown':
            engine.nextPane(); break;
          case 'k': case 'ArrowUp':
            engine.prevPane(); break;
        }
        return;
      }

      const nodeId = actions?.getSelectedNodeId?.();

      switch (e.key) {
        // Navigation
        case 'j': case 'ArrowDown':
          e.preventDefault(); engine.moveDown(); break;
        case 'k': case 'ArrowUp':
          e.preventDefault(); engine.moveUp(); break;
        case 'h': case 'ArrowLeft':
          e.preventDefault(); engine.moveLeft(); break;
        case 'l': case 'ArrowRight':
          e.preventDefault(); engine.moveRight(); break;
        case 'g':
          e.preventDefault(); engine.jumpFirst(); break;
        case 'G':
          e.preventDefault(); engine.jumpLast(); break;

        // Pane switching
        case 'Tab':
          e.preventDefault();
          if (e.shiftKey) { engine.prevPane(); } else { engine.nextPane(); }
          break;

        // Mode changes
        case 'i':
          e.preventDefault(); engine.setMode('INSERT'); break;
        case '/':
          e.preventDefault();
          engine.setMode('COMMAND');
          actions?.onSearch?.();
          break;
        case 'Escape':
          e.preventDefault();
          if (windowType === 'main' && engine.mode === 'NORMAL') {
            actions?.onHideWindow?.();
          } else if (windowType === 'settings' && !engine.activePane) {
            actions?.onCloseWindow?.();
          } else {
            engine.drillUp();
          }
          break;

        // Actions
        case 'Enter': case 'e':
          e.preventDefault();
          // Activate the currently focused node
          if (engine.activePane && engine.activeRegion) {
            const key = `${engine.activePane}:${engine.activeRegion}`;
            const nodes = engine.nodes.get(key) ?? [];
            const node = nodes[engine.activeIndex];
            if (node?.onActivate) {
              node.onActivate();
            } else if (nodeId) {
              actions?.onEdit?.(nodeId);
            }
          }
          break;
        case 'x':
          if (nodeId) { e.preventDefault(); actions?.onToggleDone?.(nodeId); }
          break;
        case 'd':
          if (nodeId) { e.preventDefault(); actions?.onDelete?.(nodeId); }
          break;
        case 'n':
          e.preventDefault(); actions?.onNewTask?.(); break;
        case 'o':
          if (nodeId) { e.preventDefault(); actions?.onOpenNote?.(nodeId); }
          break;
        case 'm':
          if (nodeId) { e.preventDefault(); actions?.onMoveTask?.(nodeId); }
          break;
        case 's':
          if (nodeId) { e.preventDefault(); actions?.onCycleStatus?.(nodeId); }
          break;
        case 'a':
          if (nodeId) { e.preventDefault(); actions?.onToggleArchive?.(nodeId); }
          break;
        case 'r':
          e.preventDefault(); actions?.onRefresh?.(); break;
        case '?':
          e.preventDefault(); actions?.onToggleHelp?.(); break;
        case ' ':
          e.preventDefault(); actions?.onToggleSource?.(); break;

        // View switching: 1/2/3
        case '1': e.preventDefault(); actions?.onSwitchView?.('list'); break;
        case '2': e.preventDefault(); actions?.onSwitchView?.('kanban'); break;
        case '3': e.preventDefault(); actions?.onSwitchView?.('calendar'); break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [windowType, actions, mode]);

  // Reset mode on window focus
  useEffect(() => {
    const handleFocus = () => focusEngine.getState().resetMode();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  return (
    <>
      {children}
      <ModeIndicator />
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/__tests__/FocusProvider.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/FocusProvider.tsx src/components/__tests__/FocusProvider.test.tsx
git commit -m "feat: add FocusProvider with centralized key dispatch for all modes"
```

---

## Task 6: Wire FocusProvider into Window Roots

**Files:**
- Modify: `src/main.tsx:39-49`

- [ ] **Step 1: Update main.tsx to wrap each window in FocusProvider**

Replace lines 39-49 of `src/main.tsx`:

```typescript
import { FocusProvider, type WindowType } from './components/FocusProvider';

const windowType: WindowType = label === 'settings' ? 'settings' : label === 'dashboard' ? 'dashboard' : 'main';

let Page: React.ReactNode;
if (label === 'settings') {
  Page = <Settings />;
} else if (label === 'dashboard') {
  Page = <Dashboard />;
} else {
  Page = <App />;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <FocusProvider windowType={windowType}>
      {Page}
    </FocusProvider>
  </React.StrictMode>
);
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/main.tsx
git commit -m "feat: wrap all window roots in FocusProvider"
```

---

## Task 7: Migrate Dashboard — Remove Old Keyboard Handlers, Wire Focus Engine

**Files:**
- Modify: `src/Dashboard.tsx`
- Modify: `src/components/KanbanBoard.tsx`
- Modify: `src/components/KanbanTaskCard.tsx`

This is the largest migration task. The dashboard currently uses `useVimBindings()` hook plus several inline `addEventListener('keydown')` blocks for context menus, delete confirmation, search, and quick-add.

- [ ] **Step 1: Remove `useVimBindings` import and call from Dashboard.tsx**

Find the import of `useVimBindings` and its invocation in Dashboard.tsx. Remove both. Also remove the inline keydown handlers for:
- Context menu Escape (lines ~280-288)
- Delete confirmation y/n (lines ~401-418)
- Search input Escape (lines ~710-715)

Keep the quick-add input's `onKeyDown` (Enter to create, Escape to close) — this is field-level behavior that stays.

- [ ] **Step 2: Add focus engine pane registration to Dashboard**

Add this near the top of the Dashboard component, after existing hooks:

```typescript
import { focusEngine } from '@/lib/focus-engine';
import { useStore } from 'zustand';
import { useFocusable } from '@/hooks/use-focusable';

// Inside Dashboard component:
const focusMode = useStore(focusEngine, (s) => s.mode);
const activePane = useStore(focusEngine, (s) => s.activePane);

// Register panes based on current view
useEffect(() => {
  const { registerPane, unregisterPane } = focusEngine.getState();

  registerPane('sidebar', { regions: ['filters'], order: 0 });

  if (viewMode === 'kanban') {
    const colRegions = columns.map((_, i) => `column-${i}`);
    registerPane('task-view', { regions: colRegions.length > 0 ? colRegions : ['column-0'], order: 1 });
  } else {
    registerPane('task-view', { regions: ['list'], order: 1 });
  }

  if (isEditorOpen) {
    registerPane('editor', { regions: ['fields'], order: 2 });
  }

  return () => {
    unregisterPane('sidebar');
    unregisterPane('task-view');
    unregisterPane('editor');
  };
}, [viewMode, columns, isEditorOpen]);
```

- [ ] **Step 3: Pass action callbacks to FocusProvider**

The FocusProvider in `main.tsx` wraps Dashboard but doesn't know about Dashboard's actions. Instead, Dashboard should pass actions up. Modify Dashboard to set actions on the focus engine or use a ref pattern.

The simplest approach: Dashboard registers action callbacks via a `useEffect`:

```typescript
useEffect(() => {
  // Store action callbacks that FocusProvider reads
  // This is done via a simple module-level ref since FocusProvider wraps Dashboard
  window.__jotActions = {
    onToggleSource: () => {
      if (yougileStore.yougileEnabled) {
        yougileStore.setActiveSource(
          yougileStore.activeSource === 'yougile' ? 'local' : 'yougile'
        );
      }
    },
    onSwitchView: (view: string) => setViewMode(view as ViewMode),
    onNewTask: () => setIsQuickAddOpen(true),
    onToggleDone: (taskId: string) => {
      if (isYougile) {
        const yt = yougileStore.tasks.find((t) => t.id === taskId);
        if (yt) void yougileStore.updateTask(yt.id, { completed: !yt.completed });
      } else {
        const lt = tasks.find((t) => t.id === taskId);
        if (lt) void updateTaskStatus({ id: lt.id, status: lt.status === 'done' ? 'todo' : 'done' });
      }
    },
    onDelete: (taskId: string) => {
      const task = activeTasks.find((t) => t.id === taskId);
      if (task) {
        setPendingDelete({
          taskId: task.id,
          taskTitle: task.title,
          source: isYougile ? 'yougile' : 'local',
          nextTaskId: null,
        });
      }
    },
    onEdit: (taskId: string) => {
      selectTask(taskId);
      setIsEditorOpen(true);
    },
    onOpenNote: (taskId: string) => {
      if (!isYougile) {
        const lt = tasks.find((t) => t.id === taskId);
        if (lt?.linkedNotePath) void openLinkedNote(lt.linkedNotePath);
      }
    },
    onMoveTask: (taskId: string) => {
      if (isYougile) {
        const colIds = yougileStore.columns.map((c) => c.id);
        const yt = yougileStore.tasks.find((t) => t.id === taskId);
        if (yt?.columnId && colIds.length > 0) {
          const idx = colIds.indexOf(yt.columnId);
          void yougileStore.moveTask(taskId, colIds[(idx + 1) % colIds.length]!);
        }
      } else {
        const { columns: cols } = useTaskStore.getState();
        const colKeys = cols.map((c) => c.statusKey);
        const lt = tasks.find((t) => t.id === taskId);
        if (lt && colKeys.length > 0) {
          const idx = colKeys.indexOf(lt.status);
          void updateTaskStatus({ id: lt.id, status: colKeys[(idx + 1) % colKeys.length] ?? 'todo' });
        }
      }
    },
    onCycleStatus: (taskId: string) => {
      if (!isYougile) {
        const { columns: cols } = useTaskStore.getState();
        const colKeys = cols.map((c) => c.statusKey);
        const lt = tasks.find((t) => t.id === taskId);
        if (lt && colKeys.length > 0) {
          const idx = colKeys.indexOf(lt.status);
          void updateTaskStatus({ id: lt.id, status: colKeys[(idx + 1) % colKeys.length] ?? 'todo' });
        }
      }
    },
    onToggleArchive: (taskId: string) => {
      if (!isYougile) {
        const lt = tasks.find((t) => t.id === taskId);
        if (lt) void updateTaskStatus({ id: lt.id, status: lt.status === 'archived' ? 'todo' : 'archived' });
      }
    },
    onRefresh: () => {
      if (isYougile) { void yougileStore.fetchTasks(); }
      else { void useTaskStore.getState().fetchTasks(); }
    },
    onToggleHelp: () => setShowHelp((h) => !h),
    onSearch: () => {
      const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement | null;
      searchInput?.focus();
    },
    getSelectedNodeId: () => {
      const s = focusEngine.getState();
      if (!s.activePane || !s.activeRegion) return null;
      const key = `${s.activePane}:${s.activeRegion}`;
      const nodes = s.nodes.get(key) ?? [];
      return nodes[s.activeIndex]?.id ?? null;
    },
  };

  return () => { delete window.__jotActions; };
}, [tasks, isYougile, yougileStore, activeTasks, selectTask, updateTaskStatus, openLinkedNote, setIsEditorOpen, setIsQuickAddOpen, viewMode]);
```

Add a type declaration for the window actions:

```typescript
// Add at the top of Dashboard.tsx or in a types file
declare global {
  interface Window {
    __jotActions?: import('./components/FocusProvider').FocusProviderProps['actions'];
  }
}
```

Then update `FocusProvider.tsx` to read from `window.__jotActions` when no `actions` prop is provided:

```typescript
// In FocusProvider's handleKeyDown, replace `actions?.` with:
const acts = actions ?? window.__jotActions;
```

- [ ] **Step 4: Remove the `useVimBindings` import from Dashboard.tsx**

Find and delete:
```typescript
import { useVimBindings, type ViewMode, type DeleteRequest } from '@/hooks/use-vim-bindings';
```

Keep `ViewMode` and `DeleteRequest` types — move them to `src/types.ts` or define locally.

Also find and remove the `useVimBindings(viewMode, { ... })` call.

- [ ] **Step 5: Handle delete confirmation via focus engine**

Replace the delete confirmation `keydown` handler with a check in FocusProvider or keep it as a small inline handler since it's modal behavior:

```typescript
// Keep this in Dashboard.tsx — it's modal-specific:
useEffect(() => {
  if (!pendingDelete) return;
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'y' || e.key === 'Enter') {
      e.preventDefault();
      confirmDelete();
    } else if (e.key === 'n' || e.key === 'Escape') {
      e.preventDefault();
      setPendingDelete(null);
    }
  };
  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}, [pendingDelete]);
```

This uses `useCapture: true` so it intercepts before FocusProvider.

- [ ] **Step 6: Handle context menu via focus engine**

Replace the context menu Escape handler similarly — keep as modal:

```typescript
useEffect(() => {
  if (!contextMenu) return;
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setContextMenu(null);
    }
  };
  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}, [contextMenu]);
```

- [ ] **Step 7: Run typecheck and dev server**

Run: `npx tsc --noEmit`
Expected: No errors

Run: `npm run tauri dev`
Expected: App launches, ModeIndicator visible, j/k navigation works in dashboard

- [ ] **Step 8: Commit**

```bash
git add src/Dashboard.tsx src/components/FocusProvider.tsx src/main.tsx
git commit -m "feat: migrate Dashboard to focus engine — remove useVimBindings, wire pane registration"
```

---

## Task 8: Wire KanbanBoard and KanbanTaskCard to Focus Engine

**Files:**
- Modify: `src/components/KanbanBoard.tsx`
- Modify: `src/components/KanbanTaskCard.tsx`

- [ ] **Step 1: Add useFocusable to KanbanTaskCard**

In `KanbanTaskCard.tsx`, replace the manual `onClick` / `onDoubleClick` with `useFocusable`:

```typescript
import { useFocusable } from '@/hooks/use-focusable';

// Inside KanbanTaskCard component, add:
const { ref: focusRef, isSelected, handleClick, handleDoubleClick } = useFocusable({
  pane: 'task-view',
  region: `column-${columnIndex}`,
  index: taskIndex,
  id: task.id,
  onSelect: () => {
    if (isYougileTask(task)) {
      useYougileStore.getState().selectTask(task.id);
    } else {
      useTaskStore.getState().selectTask(task.id);
    }
  },
  onActivate: () => setIsEditorOpen(true),
});
```

The component needs `columnIndex` and `taskIndex` as props. Update the parent (`KanbanBoard.tsx`) to pass these.

Replace the existing `onClick`/`onDoubleClick` on the card's root div:

```typescript
<div
  ref={focusRef as React.Ref<HTMLDivElement>}
  onClick={handleClick}
  onDoubleClick={handleDoubleClick}
  className={cn(
    'group rounded-lg border px-3 py-2 cursor-pointer transition-colors',
    isSelected
      ? 'border-l-2 border-l-cyan-500 bg-cyan-500/[0.03] dark:bg-cyan-500/[0.02]'
      : 'border-zinc-800 hover:border-zinc-700 dark:border-zinc-800 dark:hover:border-zinc-700',
  )}
>
```

- [ ] **Step 2: Pass columnIndex and taskIndex from KanbanBoard to KanbanTaskCard**

In `KanbanBoard.tsx`, where tasks are mapped inside each column, add index props:

```typescript
{tasksInColumn.map((task, taskIndex) => (
  <KanbanTaskCard
    key={task.id}
    task={task}
    columnIndex={columnIndex}
    taskIndex={taskIndex}
    // ... other existing props
  />
))}
```

Update KanbanTaskCard's props type to include:

```typescript
interface KanbanTaskCardProps {
  task: Task | YougileTask;
  columnIndex: number;
  taskIndex: number;
  // ... existing props
}
```

- [ ] **Step 3: Update KanbanBoard pane region registration**

The Dashboard already registers `task-view` pane with column regions. KanbanBoard doesn't need to register — only the individual cards register via `useFocusable`.

However, ensure the column regions match. If columns are dynamic (Yougile columns), the Dashboard registration must update when columns change:

```typescript
// Already handled in Task 7's useEffect that registers panes based on viewMode and columns
```

- [ ] **Step 4: Run typecheck and test kanban navigation**

Run: `npx tsc --noEmit`
Expected: No errors

Run: `npm run tauri dev`
Expected: h/l switches columns in kanban, j/k navigates within column, visual selection follows

- [ ] **Step 5: Commit**

```bash
git add src/components/KanbanBoard.tsx src/components/KanbanTaskCard.tsx
git commit -m "feat: wire KanbanTaskCard to focus engine — h/l column nav, j/k task nav"
```

---

## Task 9: Migrate Capture Bar (App.tsx) — Fix Escape Bug

**Files:**
- Modify: `src/App.tsx`

This is the critical fix: Escape in INSERT mode should switch to NORMAL mode, not hide the window.

- [ ] **Step 1: Remove the inline normal-mode keyboard handler (lines ~862-1022)**

Remove the entire `useEffect` that adds the normal-mode keydown listener. This logic is now handled by FocusProvider.

- [ ] **Step 2: Remove the insert-mode escape handler that hides the window**

Find the handler that calls `invoke('hide_window')` on Escape and remove it. The FocusProvider handles Escape:
- INSERT → NORMAL (does NOT hide)
- NORMAL + windowType='main' → calls `actions.onHideWindow` (hides)

- [ ] **Step 3: Register capture bar panes**

Add pane registration for the capture bar:

```typescript
import { focusEngine } from '@/lib/focus-engine';
import { useStore } from 'zustand';

// Inside App component:
const focusMode = useStore(focusEngine, (s) => s.mode);

useEffect(() => {
  const { registerPane, unregisterPane } = focusEngine.getState();

  if (pickerMode !== 'none') {
    registerPane('picker', { regions: ['items'], order: 0 });
  } else {
    registerPane('task-list', { regions: ['results'], order: 0 });
  }

  return () => {
    unregisterPane('picker');
    unregisterPane('task-list');
  };
}, [pickerMode]);
```

- [ ] **Step 4: Wire capture bar actions to window.__jotActions**

```typescript
useEffect(() => {
  window.__jotActions = {
    onHideWindow: () => void invoke('hide_window'),
    onEdit: (taskId: string) => {
      // Open task editor for the selected task
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        setEditingTask(task);
      }
    },
    onToggleDone: (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        void updateTaskStatus({ id: task.id, status: task.status === 'done' ? 'todo' : 'done' });
      }
    },
    onDelete: (taskId: string) => void deleteTask(taskId),
    onOpenNote: (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (task?.linkedNotePath) void openLinkedNote(task.linkedNotePath);
    },
    getSelectedNodeId: () => {
      const s = focusEngine.getState();
      if (!s.activePane || !s.activeRegion) return null;
      const key = `${s.activePane}:${s.activeRegion}`;
      const nodes = s.nodes.get(key) ?? [];
      return nodes[s.activeIndex]?.id ?? null;
    },
  };
  return () => { delete window.__jotActions; };
}, [tasks]);
```

- [ ] **Step 5: Map captureMode to focusMode**

Replace the existing `CaptureMode` state with the focus engine's mode:

```typescript
// Remove: const [captureMode, setCaptureMode] = useState<CaptureMode>('insert');
// Instead read from focus engine:
const captureMode = focusMode === 'INSERT' ? 'insert' : 'normal';
```

When the capture bar window shows, set mode to INSERT (user expects to type):

```typescript
useEffect(() => {
  // When window becomes visible, enter INSERT mode and focus input
  focusEngine.getState().setMode('INSERT');
  requestAnimationFrame(() => inputRef.current?.focus());
}, []); // runs on mount = window show
```

- [ ] **Step 6: Keep the Tab field-cycling handler in InlineTaskEditor**

The `InlineTaskEditor` component's Tab handler (lines ~76-109) is field-level INSERT behavior. Keep it as-is — it only fires when an input is focused, which is INSERT mode.

- [ ] **Step 7: Run typecheck and test capture bar**

Run: `npx tsc --noEmit`
Expected: No errors

Run: `npm run tauri dev`
Test:
1. Press Opt+Space to open capture bar → should be in INSERT mode, cursor in input
2. Type something → normal typing works
3. Press Escape → should switch to NORMAL mode (NOT hide window)
4. Press Escape again → should hide window
5. j/k in NORMAL mode → navigates task list
6. i → back to INSERT mode

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "fix: capture bar Escape now switches to NORMAL mode instead of hiding window"
```

---

## Task 10: Migrate Settings to Focus Engine

**Files:**
- Modify: `src/Settings.tsx`

- [ ] **Step 1: Remove the existing keydown handler (lines 63-111)**

Delete the entire `useEffect` that adds the `keydown` listener for h/l/Escape/Tab.

- [ ] **Step 2: Register settings panes and wire actions**

```typescript
import { focusEngine } from '@/lib/focus-engine';
import { useStore } from 'zustand';

// Inside Settings component:
const focusMode = useStore(focusEngine, (s) => s.mode);

// Register panes
useEffect(() => {
  const { registerPane, unregisterPane } = focusEngine.getState();
  registerPane('tabs', { regions: ['tab-bar'], order: 0 });
  registerPane('settings-fields', { regions: ['fields'], order: 1 });

  return () => {
    unregisterPane('tabs');
    unregisterPane('settings-fields');
  };
}, []);

// Wire actions
useEffect(() => {
  window.__jotActions = {
    onCloseWindow: () => void getCurrentWindow().close(),
    getSelectedNodeId: () => null,
  };
  return () => { delete window.__jotActions; };
}, []);
```

- [ ] **Step 3: Map h/l navigation to focus engine**

The settings tabs are a horizontal list. Register each tab as a node in the 'tabs' pane:

```typescript
// Register tab nodes
useEffect(() => {
  const engine = focusEngine.getState();
  engine.clearNodes('tabs');
  tabs.forEach((tab, i) => {
    engine.registerNode({
      pane: 'tabs',
      region: 'tab-bar',
      index: i,
      id: tab.id,
      onSelect: () => setActiveTab(tab.id),
      onActivate: () => setActiveTab(tab.id),
    });
  });
}, [tabs]);
```

h/l in NORMAL mode on the 'tabs' pane will now switch tabs via `moveLeft`/`moveRight` — but since tabs are in a single region, we need to override: tabs should use j/k or h/l within the 'tab-bar' region to move between them. Since `moveLeft`/`moveRight` moves between regions, and we have one region, we should use `moveUp`/`moveDown` to cycle tabs — but that's counterintuitive for a horizontal tab bar.

Better approach: register each tab as its own region so h/l works:

```typescript
useEffect(() => {
  const { registerPane, unregisterPane } = focusEngine.getState();
  const tabRegions = tabs.map((t) => `tab-${t.id}`);
  registerPane('tabs', { regions: tabRegions, order: 0 });
  registerPane('settings-fields', { regions: ['fields'], order: 1 });

  // Register one node per tab-region
  tabs.forEach((tab, i) => {
    focusEngine.getState().registerNode({
      pane: 'tabs',
      region: `tab-${tab.id}`,
      index: 0,
      id: tab.id,
      onSelect: () => setActiveTab(tab.id),
      onActivate: () => {
        setActiveTab(tab.id);
        // Focus the fields pane
        focusEngine.getState().focusPane('settings-fields');
      },
    });
  });

  return () => {
    unregisterPane('tabs');
    unregisterPane('settings-fields');
  };
}, [tabs]);
```

Now h/l moves between tab regions (= switches tabs), Enter/e on a tab focuses the fields pane.

- [ ] **Step 4: Add j/k navigation for settings fields**

Register each field in the active tab as a node in the 'settings-fields' pane. When Enter is pressed on a field, enter INSERT mode and focus the input:

```typescript
// This depends on the active tab. Register fields dynamically:
useEffect(() => {
  const engine = focusEngine.getState();
  engine.clearNodes('settings-fields');

  // Define fields per tab
  const fieldIds: Record<Tab, string[]> = {
    general: ['yougile-toggle'],
    vault: ['vault-path'],
    ui: ['theme-toggle'],
    accounts: ['login-key'],
  };

  const fields = fieldIds[activeTab] ?? [];
  fields.forEach((fieldId, i) => {
    engine.registerNode({
      pane: 'settings-fields',
      region: 'fields',
      index: i,
      id: fieldId,
      onActivate: () => {
        // Focus the actual input element
        const el = document.querySelector(`[data-field-id="${fieldId}"]`) as HTMLElement | null;
        el?.focus();
        engine.setMode('INSERT');
      },
    });
  });
}, [activeTab]);
```

Add `data-field-id` attributes to the settings inputs so they can be focused:

```typescript
// In the vault path input:
<input data-field-id="vault-path" ... />

// In the theme toggle:
<button data-field-id="theme-toggle" ... />

// etc.
```

- [ ] **Step 5: Add visual selection to settings fields**

Add a subtle highlight to the currently focused field. Use a data attribute approach:

```typescript
// In each settings field wrapper:
<div
  data-field-id="vault-path"
  className={cn(
    'rounded-lg p-3 transition-colors',
    isFieldSelected('vault-path')
      ? 'ring-1 ring-cyan-500/30 dark:ring-cyan-400/20'
      : ''
  )}
>
```

Where `isFieldSelected` reads from the focus engine:

```typescript
const activeIndex = useStore(focusEngine, (s) => s.activeIndex);
const activePane = useStore(focusEngine, (s) => s.activePane);

function isFieldSelected(fieldId: string): boolean {
  if (activePane !== 'settings-fields') return false;
  const key = 'settings-fields:fields';
  const nodes = focusEngine.getState().nodes.get(key) ?? [];
  return nodes[activeIndex]?.id === fieldId;
}
```

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/Settings.tsx
git commit -m "feat: migrate Settings to focus engine — full keyboard nav for tabs and fields"
```

---

## Task 11: Migrate YougileTaskEditor Keyboard Handling

**Files:**
- Modify: `src/components/YougileTaskEditor.tsx`

- [ ] **Step 1: Remove the inline Escape handler (lines ~299-307)**

Delete the `useEffect` that adds `window.addEventListener('keydown', handler, true)` for Escape.

- [ ] **Step 2: Register editor fields as focusable**

The editor pane is registered by Dashboard when `isEditorOpen` is true. Register each field as a node:

```typescript
import { focusEngine } from '@/lib/focus-engine';
import { useStore } from 'zustand';

// Inside YougileTaskEditor:
const focusMode = useStore(focusEngine, (s) => s.mode);

const editorFields = ['title', 'description', 'color', 'assignees', 'stickers', 'deadline'];

useEffect(() => {
  const engine = focusEngine.getState();
  engine.clearNodes('editor');

  editorFields.forEach((fieldId, i) => {
    engine.registerNode({
      pane: 'editor',
      region: 'fields',
      index: i,
      id: fieldId,
      onActivate: () => {
        const el = document.querySelector(`[data-editor-field="${fieldId}"]`) as HTMLElement | null;
        if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA') {
          (el as HTMLInputElement).focus();
        } else {
          el?.click();
        }
        engine.setMode('INSERT');
      },
    });
  });

  return () => engine.clearNodes('editor');
}, []);
```

- [ ] **Step 3: Add data-editor-field attributes to editor fields**

Add `data-editor-field="title"` etc. to each editable field in the editor so they can be found and focused:

```typescript
// Title input
<input data-editor-field="title" ... />

// Description textarea
<textarea data-editor-field="description" ... />

// Color picker button
<button data-editor-field="color" ... />

// etc.
```

- [ ] **Step 4: Handle Escape via focus engine**

Escape in the editor now works via FocusProvider:
- INSERT mode (typing in a field) → Escape → NORMAL mode (blur field, stay in editor)
- NORMAL mode in editor pane → Escape → drillUp → deselects editor pane → Dashboard closes editor

Add a subscription to handle editor close:

```typescript
useEffect(() => {
  return focusEngine.subscribe((state, prevState) => {
    // If editor pane was active and now isn't, close the editor
    if (prevState.activePane === 'editor' && state.activePane !== 'editor') {
      onClose(); // the existing onClose prop
    }
  });
}, [onClose]);
```

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/components/YougileTaskEditor.tsx
git commit -m "feat: migrate YougileTaskEditor to focus engine — j/k field nav, Escape drill-up"
```

---

## Task 12: Delete use-vim-bindings.ts and Clean Up

**Files:**
- Delete: `src/hooks/use-vim-bindings.ts`
- Modify: any remaining imports

- [ ] **Step 1: Search for remaining references to use-vim-bindings**

Run: `grep -r "use-vim-bindings\|useVimBindings" src/`

Remove all imports and usages found.

- [ ] **Step 2: Move ViewMode and DeleteRequest types**

If `ViewMode` and `DeleteRequest` are imported from `use-vim-bindings` elsewhere, move them:

```typescript
// Add to src/types.ts:
export type ViewMode = 'list' | 'kanban' | 'calendar';

export interface DeleteRequest {
  taskId: string;
  taskTitle: string;
  source: 'local' | 'yougile';
  nextTaskId: string | null;
}
```

Update imports in Dashboard.tsx to use `@/types`.

- [ ] **Step 3: Delete the file**

```bash
rm src/hooks/use-vim-bindings.ts
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: No errors, all tests pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete use-vim-bindings.ts — fully replaced by focus engine"
```

---

## Task 13: Visual Polish — Pane Highlights and Selection Styles

**Files:**
- Modify: `src/Dashboard.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add active pane highlight to Dashboard sections**

Add a subtle ring to the active pane's container:

```typescript
import { useStore } from 'zustand';
import { focusEngine } from '@/lib/focus-engine';

const activePane = useStore(focusEngine, (s) => s.activePane);

// Sidebar wrapper:
<aside className={cn(
  'transition-shadow rounded-lg',
  activePane === 'sidebar' && 'ring-1 ring-cyan-500/20 dark:ring-cyan-400/15'
)}>

// Task view wrapper:
<main className={cn(
  'transition-shadow rounded-lg',
  activePane === 'task-view' && 'ring-1 ring-cyan-500/20 dark:ring-cyan-400/15'
)}>

// Editor wrapper:
<div className={cn(
  'transition-shadow rounded-lg',
  activePane === 'editor' && 'ring-1 ring-cyan-500/20 dark:ring-cyan-400/15'
)}>
```

- [ ] **Step 2: Ensure dark/light mode works for all focus styles**

The Tailwind `dark:` classes handle this. Verify the existing `[data-theme="light"]` overrides in `src/styles.css` don't conflict with the ring colors. If they do, add:

```css
/* In src/styles.css under [data-theme="light"] */
[data-theme="light"] .ring-cyan-500\/20 {
  --tw-ring-color: rgb(6 182 212 / 0.2);
}
```

- [ ] **Step 3: Run the app and verify visually**

Run: `npm run tauri dev`
Expected:
- Active pane has a subtle cyan ring
- Selected task has cyan left border
- Mode indicator is visible and correct
- Toggle theme → all styles adapt properly

- [ ] **Step 4: Commit**

```bash
git add src/Dashboard.tsx src/styles.css
git commit -m "feat: add active pane highlight and polish selection styles for dark/light mode"
```

---

## Task 14: Final Integration Test & CI

**Files:**
- Modify: `src/App.test.tsx` (update if broken by FocusProvider wrapper)

- [ ] **Step 1: Update App.test.tsx for FocusProvider**

The existing test renders `<App />` directly, but now it's wrapped in `<FocusProvider>` at the `main.tsx` level. The test should still work since `<App />` is rendered standalone. But if it breaks, wrap it:

```typescript
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders the popup shell', () => {
    render(<App />);
    expect(screen.getByPlaceholderText(/type a task/i)).toBeInTheDocument();
  });
});
```

If this fails because App now expects focus engine context, wrap it:

```typescript
import { FocusProvider } from './components/FocusProvider';

render(
  <FocusProvider windowType="main">
    <App />
  </FocusProvider>
);
```

- [ ] **Step 2: Run full CI**

Run: `make ci`
Expected: All checks pass — fmt, clippy, typecheck, lint, test

- [ ] **Step 3: Fix any issues found**

Address any typecheck, lint, or test failures.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: update tests and resolve CI issues after focus engine migration"
```

---

## Summary

| Task | What it does | Key files |
|------|-------------|-----------|
| 1 | Focus engine core — types, store, registration | `focus-engine.ts` |
| 2 | Navigation logic tests | `focus-engine.test.ts` |
| 3 | `useFocusable` hook | `use-focusable.ts` |
| 4 | ModeIndicator component | `ModeIndicator.tsx` |
| 5 | FocusProvider — key dispatch | `FocusProvider.tsx` |
| 6 | Wire into window roots | `main.tsx` |
| 7 | Migrate Dashboard | `Dashboard.tsx` |
| 8 | Wire Kanban components | `KanbanBoard.tsx`, `KanbanTaskCard.tsx` |
| 9 | Migrate Capture Bar + fix Escape | `App.tsx` |
| 10 | Migrate Settings | `Settings.tsx` |
| 11 | Migrate YougileTaskEditor | `YougileTaskEditor.tsx` |
| 12 | Delete use-vim-bindings.ts | cleanup |
| 13 | Visual polish | styles |
| 14 | Final CI | tests |
