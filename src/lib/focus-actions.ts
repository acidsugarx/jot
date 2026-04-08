import { useEffect, useRef } from 'react';

import type { NormalKeyActions } from '@/lib/focus-engine';

const actionSources = new Map<string, () => NormalKeyActions>();
const actionOrder: string[] = [];

function unregisterActionSource(id: string) {
  actionSources.delete(id);
  const index = actionOrder.indexOf(id);
  if (index >= 0) {
    actionOrder.splice(index, 1);
  }
}

export function registerNormalKeyActions(id: string, getActions: () => NormalKeyActions) {
  if (!actionSources.has(id)) {
    actionOrder.push(id);
  }
  actionSources.set(id, getActions);

  return () => {
    unregisterActionSource(id);
  };
}

export function resolveNormalKeyActions(baseActions: NormalKeyActions = {}): NormalKeyActions {
  return actionOrder.reduce<NormalKeyActions>((merged, id) => {
    const next = actionSources.get(id)?.();
    return next ? { ...merged, ...next } : merged;
  }, { ...baseActions });
}

export function useRegisteredNormalKeyActions(id: string, actions: NormalKeyActions) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => registerNormalKeyActions(id, () => actionsRef.current), [id]);
}
