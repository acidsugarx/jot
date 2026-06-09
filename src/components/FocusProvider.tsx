import { type ReactNode, useEffect, useCallback } from 'react';
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
import { captureKeysBlocked } from '@/lib/capture-keys';

interface FocusProviderProps {
  children: ReactNode;
  engine?: StoreApi<FocusState>;
  actions?: NormalKeyActions;
  showIndicator?: boolean;
  captureKeys?: boolean;
}
/** Return true when the target is an editable field (input, textarea, contenteditable). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function FocusProvider({
  children,
  engine = focusEngine,
  actions,
  showIndicator = true,
  captureKeys = false,
}: FocusProviderProps) {
  // Auto-switch to INSERT when mouse clicks into an editable field.
  // This makes the editor feel natural for mouse users: click → type immediately.
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!captureKeys) return;
    const engineState = engine.getState();
    if (isEditableTarget(event.target)) {
      // Click in editable → ensure we're in INSERT so mode indicator is honest
      // and Escape works correctly (INSERT→NORMAL, not close editor)
      if (engineState.mode !== 'INSERT') {
        engineState.setMode('INSERT');
      }
    }
  }, [captureKeys, engine]);

  useEffect(() => {
    if (!captureKeys) return;

    window.addEventListener('mousedown', handleMouseDown, true);
    return () => window.removeEventListener('mousedown', handleMouseDown, true);
  }, [captureKeys, handleMouseDown]);

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
