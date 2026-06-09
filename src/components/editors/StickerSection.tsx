// ── Sticker Section — Yougile task sticker/label fields ─────────────────────
//
// Extracted from YougileTaskEditor.tsx (Phase 4).
// ──────────────────────────────────────────────────────────────────────────────

import { useRef, useCallback } from 'react';
import { formatStickerValue } from '@/lib/yougile-editor';
import { useFocusable } from '@/hooks/use-focusable';
import { focusEngine } from '@/lib/focus-engine';

// ══════════════════════════════════════════════════════════════════════════════

export interface StickerDef {
  id: string;
  name: string;
  states: Array<{ id: string; name: string; color?: string }>;
  freeText: boolean;
}

interface StickerSectionProps {
  stickerDefinitions: StickerDef[];
  stickerValues: Record<string, string>;
  stickerStateLookup: Record<string, { stickerName: string; valueName: string }>;
  stickerDefinitionLookup: Record<string, { name: string; freeText: boolean }>;
  onStickerChange: (stickerId: string, value: string) => void;
  baseIndex: number;
}

// ══════════════════════════════════════════════════════════════════════════════

function StickerField({
  sticker,
  value,
  onStickerChange,
  onVimKeyDown,
  baseIndex,
  stickerIndex,
}: {
  sticker: StickerDef;
  value: string;
  onStickerChange: (id: string, value: string) => void;
  onVimKeyDown: (
    event: React.KeyboardEvent<HTMLSelectElement>,
    options: string[],
    currentValue: string,
    onChange: (value: string) => void,
  ) => void;
  baseIndex: number;
  stickerIndex: number;
}) {
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const { ref: fieldRef, isSelected } = useFocusable<HTMLDivElement>({
    pane: 'editor',
    region: 'editor',
    index: baseIndex + stickerIndex,
    id: `yougile-sticker-${sticker.id}`,
    onActivate: () => {
      inputRef.current?.focus();
      focusEngine.getState().setMode('INSERT');
    },
  });

  const optionValues = ['', 'empty', ...sticker.states.map((state) => state.id)];

  return (
    <div
      ref={fieldRef}
      className={`flex items-center justify-between gap-3 rounded px-1 transition-shadow duration-150 ${isSelected ? 'ring-1 ring-inset ring-cyan-500/20' : ''}`}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-500">
        {sticker.name}
      </span>
      {sticker.freeText ? (
        <input
          ref={(el) => { inputRef.current = el; }}
          type="text"
          value={value}
          onChange={(event) => {
            const nextValue = event.target.value;
            onStickerChange(sticker.id, nextValue);
          }}
          onBlur={(event) => onStickerChange(sticker.id, event.target.value)}
          className="w-40 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none placeholder:text-zinc-700"
          placeholder="Value"
        />
      ) : (
        <select
          ref={(el) => { inputRef.current = el; }}
          value={value}
          onChange={(event) => onStickerChange(sticker.id, event.target.value)}
          onKeyDown={(event) => {
            onVimKeyDown(event, optionValues, value, (nextValue) => {
              onStickerChange(sticker.id, nextValue);
            });
          }}
          className="w-40 bg-transparent text-right text-xs text-zinc-300 focus:outline-none cursor-pointer"
        >
          <option value="">Not set</option>
          <option value="empty">Empty</option>
          {sticker.states.map((state) => (
            <option key={state.id} value={state.id}>{state.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════

export function StickerSection({
  stickerDefinitions,
  stickerValues,
  stickerStateLookup,
  stickerDefinitionLookup,
  onStickerChange,
  baseIndex,
}: StickerSectionProps) {
  const handleVimSelectKeyDown = useCallback((
    event: React.KeyboardEvent<HTMLSelectElement>,
    options: string[],
    currentValue: string,
    onChange: (value: string) => void,
  ) => {
    if (options.length === 0) return;
    const key = event.key;
    const direction = key === 'j' || key === 'l'
      ? 1
      : key === 'k' || key === 'h'
        ? -1
        : 0;
    if (direction === 0) return;
    event.preventDefault();
    const currentIndex = options.indexOf(currentValue);
    const fallbackIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (fallbackIndex + direction + options.length) % options.length;
    const nextId = options[nextIndex];
    if (nextId !== undefined) {
      onChange(nextId);
    }
  }, []);

  if (stickerDefinitions.length === 0 && Object.keys(stickerValues).length === 0) {
    return null;
  }

  return (
    <div className="border-b border-zinc-800/30 px-4 py-3">
      <div className="mb-2">
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Stickers
        </span>
      </div>

      {stickerDefinitions.length > 0 && (
        <div className="flex flex-col gap-2">
          {stickerDefinitions.map((sticker, idx) => (
            <StickerField
              key={sticker.id}
              sticker={sticker}
              value={stickerValues[sticker.id] ?? ''}
              onStickerChange={onStickerChange}
              onVimKeyDown={handleVimSelectKeyDown}
              baseIndex={baseIndex}
              stickerIndex={idx}
            />
          ))}
        </div>
      )}

      {Object.entries(stickerValues).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(stickerValues).map(([key, value]) => {
            const resolvedState = stickerStateLookup[value];
            const resolvedSticker = stickerDefinitionLookup[key];
            const label = resolvedState
              ? `${resolvedState.stickerName}: ${resolvedState.valueName}`
              : resolvedSticker
                ? `${resolvedSticker.name}: ${value}`
                : formatStickerValue(value, key);

            return (
              <span
                key={key}
                className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500"
              >
                {label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
