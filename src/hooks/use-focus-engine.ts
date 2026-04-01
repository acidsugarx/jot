import { useContext, useMemo, useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand/vanilla';

import {
  focusEngine,
  type FocusState,
} from '@/lib/focus-engine';
import { FocusEngineContext } from '@/components/focus-engine-context';

function useFocusStoreApi(): StoreApi<FocusState> {
  return useContext(FocusEngineContext) ?? focusEngine;
}

export function useFocusEngineStore<T>(selector: (state: FocusState) => T): T {
  const engine = useFocusStoreApi();

  return useSyncExternalStore(
    engine.subscribe,
    () => selector(engine.getState()),
    () => selector(engine.getState())
  );
}

export function useFocusEngine() {
  const engine = useFocusStoreApi();
  const state = useFocusEngineStore((current) => current);

  return useMemo(() => ({
    engine,
    state,
  }), [engine, state]);
}
