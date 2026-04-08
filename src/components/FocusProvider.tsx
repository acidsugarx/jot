import { type ReactNode, useEffect } from 'react';
import type { StoreApi } from 'zustand/vanilla';

import {
  dispatchFocusKey,
  focusEngine,
  type FocusState,
  type NormalKeyActions,
} from '@/lib/focus-engine';
import { resolveNormalKeyActions } from '@/lib/focus-actions';
import { FocusEngineContext } from '@/components/focus-engine-context';
import { ModeIndicator } from '@/components/ModeIndicator';
import { captureKeysBlocked } from '@/App';

interface FocusProviderProps {
  children: ReactNode;
  engine?: StoreApi<FocusState>;
  actions?: NormalKeyActions;
  showIndicator?: boolean;
  captureKeys?: boolean;
}

export function FocusProvider({
  children,
  engine = focusEngine,
  actions,
  showIndicator = true,
  captureKeys = false,
}: FocusProviderProps) {
  useEffect(() => {
    if (!captureKeys) return;

    const handler = (event: KeyboardEvent) => {
      // Skip when capture overlay has a picker open — App.tsx handles those keys
      if (captureKeysBlocked) return;
      const prevMode = engine.getState().mode;
      const result = dispatchFocusKey(engine, event, resolveNormalKeyActions(actions));
      if (result.stopPropagation) {
        event.stopPropagation();
      }
      // When Escape transitions from INSERT/COMMAND → NORMAL, blur the
      // active element so subsequent hjkl keys aren't swallowed by the
      // isEditableElement guard in dispatchFocusKey.
      if (event.key === 'Escape' && prevMode !== 'NORMAL' && engine.getState().mode === 'NORMAL') {
        const active = document.activeElement;
        if (active instanceof HTMLElement) {
          active.blur();
        }
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [actions, captureKeys, engine]);

  useEffect(() => {
    const handler = () => {
      engine.getState().resetMode();
    };

    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [engine]);

  return (
    <FocusEngineContext.Provider value={engine}>
      {children}
      {showIndicator ? <ModeIndicator /> : null}
    </FocusEngineContext.Provider>
  );
}
