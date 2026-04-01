import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { FocusProvider } from '@/components/FocusProvider';
import { createFocusEngine } from '@/lib/focus-engine';
import { useFocusable } from '@/hooks/use-focusable';

describe('useFocusable', () => {
  const engine = createFocusEngine();

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FocusProvider engine={engine} showIndicator={false}>
      {children}
    </FocusProvider>
  );

  beforeEach(() => {
    const state = engine.getState();
    for (const key of state.panes.keys()) {
      state.unregisterPane(key);
    }

    state.setMode('NORMAL');
    state.registerPane('task-view', {
      regions: ['column-0'],
      order: 1,
    });
    state.focusPane('task-view');
  });

  it('registers node on mount and unregisters on unmount', () => {
    const { unmount } = renderHook(
      () => useFocusable({
        pane: 'task-view',
        region: 'column-0',
        index: 0,
        id: 'task-1',
      }),
      { wrapper }
    );

    const key = 'task-view:column-0';
    expect(engine.getState().nodes.get(key)?.length).toBe(1);

    unmount();
    expect(engine.getState().nodes.get(key)).toBeUndefined();
  });

  it('returns isSelected true when node matches active state', () => {
    const { result } = renderHook(
      () => useFocusable({
        pane: 'task-view',
        region: 'column-0',
        index: 0,
        id: 'task-1',
      }),
      { wrapper }
    );

    expect(result.current.isSelected).toBe(true);
  });

  it('returns isSelected false when index does not match', () => {
    const { result } = renderHook(
      () => useFocusable({
        pane: 'task-view',
        region: 'column-0',
        index: 1,
        id: 'task-2',
      }),
      { wrapper }
    );

    expect(result.current.isSelected).toBe(false);
  });
});
