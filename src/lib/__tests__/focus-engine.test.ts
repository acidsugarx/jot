import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFocusEngine, dispatchFocusKey } from '@/lib/focus-engine';

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

describe('FocusEngine navigation', () => {
  let engine: ReturnType<typeof createFocusEngine>;

  beforeEach(() => {
    engine = createFocusEngine();
    engine.getState().registerPane('task-view', {
      regions: ['column-0', 'column-1', 'column-2'],
      order: 1,
    });

    engine.getState().registerNode({ pane: 'task-view', region: 'column-0', index: 0, id: 'task-1' });
    engine.getState().registerNode({ pane: 'task-view', region: 'column-0', index: 1, id: 'task-2' });
    engine.getState().registerNode({ pane: 'task-view', region: 'column-0', index: 2, id: 'task-3' });

    engine.getState().registerNode({ pane: 'task-view', region: 'column-1', index: 0, id: 'task-4' });
    engine.getState().registerNode({ pane: 'task-view', region: 'column-1', index: 1, id: 'task-5' });

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
    engine.getState().moveDown();
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
    engine.getState().focusIndex(2);
    engine.getState().moveRight();
    expect(engine.getState().activeRegion).toBe('column-1');
    expect(engine.getState().activeIndex).toBe(1);
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

  it('ctrl+w then direction switches pane', () => {
    const keydown = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true });
    dispatchFocusKey(engine, keydown);

    const right = new KeyboardEvent('keydown', { key: 'l' });
    dispatchFocusKey(engine, right);

    expect(engine.getState().activePane).toBe('editor');
    expect(engine.getState().pendingPaneSwitch).toBe(false);
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
    expect(engine.getState().activePane).toBe('task-view');
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

describe('dispatchFocusKey', () => {
  it('calls bound action keys in NORMAL mode', () => {
    const engine = createFocusEngine();
    const onNewItem = vi.fn();
    const onSwitchView = vi.fn();

    dispatchFocusKey(engine, new KeyboardEvent('keydown', { key: 'n' }), {
      onNewItem,
      onSwitchView,
    });
    dispatchFocusKey(engine, new KeyboardEvent('keydown', { key: '2' }), {
      onNewItem,
      onSwitchView,
    });

    expect(onNewItem).toHaveBeenCalledTimes(1);
    expect(onSwitchView).toHaveBeenCalledWith('kanban');
  });

  it('handles Escape in INSERT mode', () => {
    const engine = createFocusEngine();
    engine.getState().setMode('INSERT');

    const result = dispatchFocusKey(engine, new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(result.handled).toBe(true);
    expect(engine.getState().mode).toBe('NORMAL');
  });
});
