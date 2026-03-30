import { type ReactNode, useEffect } from 'react';
import type { StoreApi } from 'zustand/vanilla';

import {
  dispatchFocusKey,
  focusEngine,
  type FocusState,
  type NormalKeyActions,
} from '@/lib/focus-engine';
import { FocusEngineContext } from '@/components/focus-engine-context';
import { ModeIndicator } from '@/components/ModeIndicator';

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
      const result = dispatchFocusKey(engine, event, actions ?? window.__jotActions);
      if (result.stopPropagation) {
        event.stopPropagation();
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
