import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { useFocusStoreApi, useFocusEngineStore } from '@/hooks/use-focus-engine';

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

export interface UseFocusableResult<T extends HTMLElement> {
  ref: RefObject<T | null>;
  isSelected: boolean;
  isPaneActive: boolean;
  focus: () => void;
}

export function useFocusable<T extends HTMLElement = HTMLElement>(
  options: UseFocusableOptions
): UseFocusableResult<T> {
  const engine = useFocusStoreApi();
  const ref = useRef<T | null>(null);

  // Keep latest callbacks in refs so the registration effect stays stable.
  // Without this, inline arrow functions (e.g. onSelect={() => select(id)})
  // change identity every render, causing the effect to re-register all nodes
  // on every render — which resets activeIndex via unregister/register churn.
  const onSelectRef = useRef(options.onSelect);
  onSelectRef.current = options.onSelect;
  const onActivateRef = useRef(options.onActivate);
  onActivateRef.current = options.onActivate;
  const onEnterRef = useRef(options.onEnter);
  onEnterRef.current = options.onEnter;

  // Also keep structural options in refs so the `focus` helper always reads
  // the latest values without needing them in a useCallback dep array.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const isSelected = useFocusEngineStore((state) => (
    state.activePane === options.pane
      && state.activeRegion === options.region
      && state.activeIndex === options.index
  ));

  const isPaneActive = useFocusEngineStore((state) => state.activePane === options.pane);

  useEffect(() => {
    if (options.disabled) return;

    engine.getState().registerNode({
      pane: options.pane,
      region: options.region,
      index: options.index,
      id: options.id,
      // Use ref-reading wrappers so the node registration is structurally
      // stable — the effect only re-fires when pane/region/index/id/disabled
      // actually change, not when callbacks are recreated.
      onSelect: () => onSelectRef.current?.(),
      onActivate: () => onActivateRef.current?.(),
      onEnter: () => onEnterRef.current?.(),
    });

    return () => {
      engine.getState().unregisterNode(options.pane, options.region, options.id);
    };
  }, [
    engine,
    options.disabled,
    options.id,
    options.index,
    options.pane,
    options.region,
  ]);

  const focus = () => {
    const opts = optionsRef.current;
    if (opts.disabled) return;

    engine.getState().focusNode(opts.pane, opts.region, opts.index);
    onSelectRef.current?.();
    ref.current?.focus();
  };

  return {
    ref,
    isSelected,
    isPaneActive,
    focus,
  };
}
