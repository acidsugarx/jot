// ── Editor Header — navigation, color dot, title, close button ────────────
//
// Extracted from YougileTaskEditor.tsx (Phase 4).
// ──────────────────────────────────────────────────────────────────────────────

import { ArrowLeft, X } from 'lucide-react';
import type { YougileTask } from '@/types/yougile';

interface EditorHeaderProps {
  onNavigateBack?: () => void;
  parentTask: YougileTask | null | undefined;
  colorHex: string;
  onClose: () => void;
}

export function EditorHeader({ onNavigateBack, parentTask, colorHex, onClose }: EditorHeaderProps) {
  return (
    <div className="shrink-0 flex h-11 items-center justify-between border-b border-zinc-800/40 px-4">
      <div className="flex items-center gap-2 min-w-0">
        {onNavigateBack && (
          <button
            type="button"
            onClick={onNavigateBack}
            className="shrink-0 rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
            title={`Back to ${parentTask?.title ?? 'parent'}`}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <div
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: colorHex }}
        />
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600 truncate">
          {parentTask ? 'Subtask' : 'Yougile Task'}
        </span>
        {parentTask && (
          <span className="font-mono text-[10px] text-zinc-700 truncate">
            of {parentTask.title}
          </span>
        )}
      </div>
      <button
        onClick={onClose}
        className="rounded p-1 text-zinc-700 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
