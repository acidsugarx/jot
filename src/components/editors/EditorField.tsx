// ── Editor Field — focusable wrapper for Yougile task editor fields ────────
//
// Extracted from YougileTaskEditor.tsx (Phase 4).
// Wraps each editor field as a focusable node for j/k navigation.
// ──────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from 'react';
import { focusEngine } from '@/lib/focus-engine';
import { useFocusable } from '@/hooks/use-focusable';

interface EditorFieldProps {
  index: number;
  id?: string;
  onActivate?: () => void;
  onEnter?: () => void;
  children: (isSelected: boolean) => ReactNode;
}

export function EditorField({ index, id: idProp, onActivate, onEnter, children }: EditorFieldProps) {
  const { ref, isSelected } = useFocusable<HTMLDivElement>({
    pane: 'editor',
    region: 'editor',
    index,
    id: idProp ?? `yougile-field-${index}`,
    onActivate: () => {
      onActivate?.();
      focusEngine.getState().setMode('INSERT');
    },
    onEnter,
  });

  return (
    <div ref={ref}>
      {children(isSelected)}
    </div>
  );
}
