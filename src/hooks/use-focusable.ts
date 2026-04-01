import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { useFocusEngine, useFocusEngineStore } from '@/hooks/use-focus-engine';

export interface UseFocusableOptions {
  pane: string;
  region: string;
  index: number;
  id: string;
  onSelect?: () => void;
  onActivate?: () => void;
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
  const { engine } = useFocusEngine();
  const ref = useRef<T | null>(null);

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
      onSelect: options.onSelect,
      onActivate: options.onActivate,
    });

    return () => {
      engine.getState().unregisterNode(options.pane, options.region, options.id);
    };
  }, [
    engine,
    options.disabled,
    options.id,
    options.index,
    options.onActivate,
    options.onSelect,
    options.pane,
    options.region,
  ]);

  const focus = () => {
    if (options.disabled) return;

    engine.getState().focusNode(options.pane, options.region, options.index);
    options.onSelect?.();
    ref.current?.focus();
  };

  return {
    ref,
    isSelected,
    isPaneActive,
    focus,
  };
}
