import { createStore, type StoreApi } from 'zustand/vanilla';

export type FocusMode = 'NORMAL' | 'INSERT' | 'COMMAND';
export type PaneDirection = 'left' | 'right' | 'up' | 'down';

export interface PaneConfig {
  regions: string[];
  order: number;
}

export interface FocusNode {
  pane: string;
  region: string;
  index: number;
  id: string;
  onSelect?: () => void;
  onActivate?: () => void;
}

export interface NormalKeyActions {
  onDelete?: () => void;
  onToggleDone?: () => void;
  onNewItem?: () => void;
  onOpenItem?: () => void;
  onMoveNext?: () => void;
  onRefresh?: () => void;
  onToggleHelp?: () => void;
  onSourceToggle?: () => void;
  onSwitchView?: (view: 'list' | 'kanban' | 'calendar') => void;
  onEscape?: () => void;
}

export interface KeyDispatchResult {
  handled: boolean;
  stopPropagation?: boolean;
}

export interface FocusState {
  mode: FocusMode;
  commandInput: string;
  activePane: string | null;
  activeRegion: string | null;
  activeIndex: number;
  panes: Map<string, PaneConfig>;
  nodes: Map<string, FocusNode[]>;
  pendingPaneSwitch: boolean;

  registerPane: (id: string, config: PaneConfig) => void;
  unregisterPane: (id: string) => void;
  registerNode: (node: FocusNode) => void;
  unregisterNode: (pane: string, region: string, id: string) => void;
  clearNodes: (pane: string, region?: string) => void;

  setMode: (mode: FocusMode) => void;
  setCommandInput: (value: string) => void;
  beginPaneSwitch: () => void;
  focusPane: (paneId: string) => void;
  focusRegion: (region: string) => void;
  focusIndex: (index: number) => void;
  focusNode: (pane: string, region: string, index: number) => void;

  moveUp: () => void;
  moveDown: () => void;
  moveLeft: () => void;
  moveRight: () => void;
  jumpFirst: () => void;
  jumpLast: () => void;
  nextPane: () => void;
  prevPane: () => void;
  switchPaneDirectional: (direction: PaneDirection) => void;

  activateSelection: () => void;
  drillUp: () => void;
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

function getDirectionalPaneIndex(index: number, direction: PaneDirection, count: number) {
  if (count <= 0) return index;
  if (direction === 'left' || direction === 'up') {
    return (index - 1 + count) % count;
  }
  return (index + 1) % count;
}

function getActiveList(state: FocusState): FocusNode[] {
  if (!state.activePane || !state.activeRegion) return [];
  return state.nodes.get(getRegionKey(state.activePane, state.activeRegion)) ?? [];
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function createFocusEngine() {
  return createStore<FocusState>((set, get) => ({
    mode: 'NORMAL',
    commandInput: '',
    activePane: null,
    activeRegion: null,
    activeIndex: 0,
    panes: new Map(),
    nodes: new Map(),
    pendingPaneSwitch: false,

    registerPane: (id, config) => set((state) => {
      const panes = new Map(state.panes);
      panes.set(id, config);

      const shouldSelectFirstPane = state.activePane === null;
      const nextRegion = shouldSelectFirstPane
        ? (config.regions[0] ?? null)
        : state.activeRegion;

      return {
        panes,
        activePane: shouldSelectFirstPane ? id : state.activePane,
        activeRegion: nextRegion,
      };
    }),

    unregisterPane: (id) => set((state) => {
      const panes = new Map(state.panes);
      panes.delete(id);

      const nodes = new Map(state.nodes);
      for (const key of nodes.keys()) {
        if (key.startsWith(`${id}:`)) {
          nodes.delete(key);
        }
      }

      if (state.activePane !== id) {
        return { panes, nodes };
      }

      const remaining = getSortedPanes(panes);
      const fallbackPane = remaining[0] ?? null;
      const fallbackRegion = fallbackPane ? (panes.get(fallbackPane)?.regions[0] ?? null) : null;

      return {
        panes,
        nodes,
        activePane: fallbackPane,
        activeRegion: fallbackRegion,
        activeIndex: 0,
      };
    }),

    registerNode: (node) => set((state) => {
      const key = getRegionKey(node.pane, node.region);
      const nodes = new Map(state.nodes);
      const current = [...(nodes.get(key) ?? [])];
      const existingIndex = current.findIndex((item) => item.id === node.id);

      if (existingIndex >= 0) {
        current[existingIndex] = node;
      } else {
        current.push(node);
      }

      current.sort((a, b) => a.index - b.index);
      nodes.set(key, current);
      return { nodes };
    }),

    unregisterNode: (pane, region, id) => set((state) => {
      const key = getRegionKey(pane, region);
      const nodes = new Map(state.nodes);
      const nextList = (nodes.get(key) ?? []).filter((item) => item.id !== id);
      if (nextList.length === 0) {
        nodes.delete(key);
      } else {
        nodes.set(key, nextList);
      }

      if (state.activePane === pane && state.activeRegion === region) {
        const maxIndex = Math.max(0, nextList.length - 1);
        return { nodes, activeIndex: Math.min(state.activeIndex, maxIndex) };
      }

      return { nodes };
    }),

    clearNodes: (pane, region) => set((state) => {
      const nodes = new Map(state.nodes);
      if (region) {
        nodes.delete(getRegionKey(pane, region));
      } else {
        for (const key of nodes.keys()) {
          if (key.startsWith(`${pane}:`)) {
            nodes.delete(key);
          }
        }
      }
      return { nodes };
    }),

    setMode: (mode) => set({ mode }),

    setCommandInput: (commandInput) => set({ commandInput }),

    beginPaneSwitch: () => set({ pendingPaneSwitch: true }),

    focusPane: (paneId) => {
      const state = get();
      const pane = state.panes.get(paneId);
      if (!pane) return;
      set({
        activePane: paneId,
        activeRegion: pane.regions[0] ?? null,
        activeIndex: 0,
      });
    },

    focusRegion: (region) => set({ activeRegion: region, activeIndex: 0 }),

    focusIndex: (index) => {
      const state = get();
      const list = getActiveList(state);
      if (list.length === 0) {
        set({ activeIndex: 0 });
        return;
      }
      const clamped = Math.max(0, Math.min(index, list.length - 1));
      set({ activeIndex: clamped });
      list[clamped]?.onSelect?.();
    },

    focusNode: (pane, region, index) => set({
      activePane: pane,
      activeRegion: region,
      activeIndex: Math.max(0, index),
    }),

    moveDown: () => {
      const state = get();
      const list = getActiveList(state);
      if (list.length === 0) return;
      const next = Math.min(state.activeIndex + 1, list.length - 1);
      set({ activeIndex: next });
      list[next]?.onSelect?.();
    },

    moveUp: () => {
      const state = get();
      const list = getActiveList(state);
      if (list.length === 0) return;
      const prev = Math.max(state.activeIndex - 1, 0);
      set({ activeIndex: prev });
      list[prev]?.onSelect?.();
    },

    moveLeft: () => {
      const state = get();
      if (!state.activePane || !state.activeRegion) return;

      const pane = state.panes.get(state.activePane);
      if (!pane) return;

      const regionIndex = pane.regions.indexOf(state.activeRegion);
      if (regionIndex <= 0) return;

      const nextRegion = pane.regions[regionIndex - 1];
      if (!nextRegion) return;

      const list = state.nodes.get(getRegionKey(state.activePane, nextRegion)) ?? [];
      const nextIndex = Math.min(state.activeIndex, Math.max(0, list.length - 1));
      set({ activeRegion: nextRegion, activeIndex: nextIndex });
      list[nextIndex]?.onSelect?.();
    },

    moveRight: () => {
      const state = get();
      if (!state.activePane || !state.activeRegion) return;

      const pane = state.panes.get(state.activePane);
      if (!pane) return;

      const regionIndex = pane.regions.indexOf(state.activeRegion);
      if (regionIndex < 0 || regionIndex >= pane.regions.length - 1) return;

      const nextRegion = pane.regions[regionIndex + 1];
      if (!nextRegion) return;

      const list = state.nodes.get(getRegionKey(state.activePane, nextRegion)) ?? [];
      const nextIndex = Math.min(state.activeIndex, Math.max(0, list.length - 1));
      set({ activeRegion: nextRegion, activeIndex: nextIndex });
      list[nextIndex]?.onSelect?.();
    },

    jumpFirst: () => {
      const state = get();
      const list = getActiveList(state);
      if (list.length === 0) return;
      set({ activeIndex: 0 });
      list[0]?.onSelect?.();
    },

    jumpLast: () => {
      const state = get();
      const list = getActiveList(state);
      if (list.length === 0) return;
      const last = list.length - 1;
      set({ activeIndex: last });
      list[last]?.onSelect?.();
    },

    nextPane: () => {
      const state = get();
      const ordered = getSortedPanes(state.panes);
      if (ordered.length === 0) return;

      const current = state.activePane ? ordered.indexOf(state.activePane) : -1;
      const nextPane = ordered[(current + 1) % ordered.length];
      if (nextPane) {
        get().focusPane(nextPane);
      }
    },

    prevPane: () => {
      const state = get();
      const ordered = getSortedPanes(state.panes);
      if (ordered.length === 0) return;

      const current = state.activePane ? ordered.indexOf(state.activePane) : 0;
      const prevPane = ordered[(current - 1 + ordered.length) % ordered.length];
      if (prevPane) {
        get().focusPane(prevPane);
      }
    },

    switchPaneDirectional: (direction) => {
      const state = get();
      const ordered = getSortedPanes(state.panes);
      if (ordered.length === 0) return;

      const current = state.activePane ? ordered.indexOf(state.activePane) : 0;
      const target = ordered[getDirectionalPaneIndex(current, direction, ordered.length)];
      if (target) {
        get().focusPane(target);
      }
      set({ pendingPaneSwitch: false });
    },

    activateSelection: () => {
      const state = get();
      const list = getActiveList(state);
      list[state.activeIndex]?.onActivate?.();
    },

    drillUp: () => {
      const state = get();

      if (state.pendingPaneSwitch) {
        set({ pendingPaneSwitch: false });
        return;
      }

      if (state.mode === 'INSERT' || state.mode === 'COMMAND') {
        set({ mode: 'NORMAL', commandInput: '' });
        return;
      }

      if (state.activePane !== null) {
        set({ activePane: null, activeRegion: null, activeIndex: 0 });
      }
    },

    resetMode: () => set({
      mode: 'NORMAL',
      commandInput: '',
      pendingPaneSwitch: false,
    }),
  }));
}

export const focusEngine = createFocusEngine();

export function dispatchFocusKey(
  engine: StoreApi<FocusState>,
  event: KeyboardEvent,
  actions: NormalKeyActions = {}
): KeyDispatchResult {
  const state = engine.getState();

  if (state.pendingPaneSwitch) {
    switch (event.key) {
      case 'h':
      case 'ArrowLeft':
        event.preventDefault();
        state.switchPaneDirectional('left');
        return { handled: true };
      case 'j':
      case 'ArrowDown':
        event.preventDefault();
        state.switchPaneDirectional('down');
        return { handled: true };
      case 'k':
      case 'ArrowUp':
        event.preventDefault();
        state.switchPaneDirectional('up');
        return { handled: true };
      case 'l':
      case 'ArrowRight':
        event.preventDefault();
        state.switchPaneDirectional('right');
        return { handled: true };
      case 'Escape':
        event.preventDefault();
        state.drillUp();
        return { handled: true };
      default:
        return { handled: false };
    }
  }

  if (state.mode === 'INSERT') {
    if (event.key === 'Escape') {
      event.preventDefault();
      state.drillUp();
      return { handled: true, stopPropagation: true };
    }

    if (event.key === 'Tab') {
      if (isEditableElement(event.target)) {
        return { handled: false };
      }
      event.preventDefault();
      if (event.shiftKey) {
        state.prevPane();
      } else {
        state.nextPane();
      }
      return { handled: true };
    }

    return { handled: false };
  }

  if (state.mode === 'COMMAND') {
    if (event.key === 'Escape') {
      event.preventDefault();
      state.drillUp();
      return { handled: true };
    }
    return { handled: false };
  }

  if (event.ctrlKey && event.key.toLowerCase() === 'w') {
    event.preventDefault();
    state.beginPaneSwitch();
    return { handled: true };
  }

  switch (event.key) {
    case 'j':
    case 'ArrowDown':
      event.preventDefault();
      state.moveDown();
      return { handled: true };
    case 'k':
    case 'ArrowUp':
      event.preventDefault();
      state.moveUp();
      return { handled: true };
    case 'h':
    case 'ArrowLeft':
      event.preventDefault();
      state.moveLeft();
      return { handled: true };
    case 'l':
    case 'ArrowRight':
      event.preventDefault();
      state.moveRight();
      return { handled: true };
    case 'g':
      event.preventDefault();
      state.jumpFirst();
      return { handled: true };
    case 'G':
      event.preventDefault();
      state.jumpLast();
      return { handled: true };
    case 'Tab':
      event.preventDefault();
      if (event.shiftKey) {
        state.prevPane();
      } else {
        state.nextPane();
      }
      return { handled: true };
    case 'Enter':
    case 'e':
      event.preventDefault();
      state.activateSelection();
      actions.onOpenItem?.();
      return { handled: true };
    case 'Escape':
      event.preventDefault();
      state.drillUp();
      actions.onEscape?.();
      return { handled: true };
    case 'i':
      event.preventDefault();
      state.setMode('INSERT');
      return { handled: true };
    case '/':
      event.preventDefault();
      state.setMode('COMMAND');
      return { handled: true };
    case 'x':
      actions.onToggleDone?.();
      return { handled: true };
    case 'd':
      actions.onDelete?.();
      return { handled: true };
    case 'n':
      actions.onNewItem?.();
      return { handled: true };
    case 'o':
      actions.onOpenItem?.();
      return { handled: true };
    case 'm':
      actions.onMoveNext?.();
      return { handled: true };
    case 'r':
      actions.onRefresh?.();
      return { handled: true };
    case '?':
      event.preventDefault();
      actions.onToggleHelp?.();
      return { handled: true };
    case ' ':
      event.preventDefault();
      actions.onSourceToggle?.();
      return { handled: true };
    case '1':
      actions.onSwitchView?.('list');
      return { handled: true };
    case '2':
      actions.onSwitchView?.('kanban');
      return { handled: true };
    case '3':
      actions.onSwitchView?.('calendar');
      return { handled: true };
    default:
      return { handled: false };
  }
}
