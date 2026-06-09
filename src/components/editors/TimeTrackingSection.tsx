// ── Time Tracking Section — Yougile task time tracking display ─────────────
//
// Extracted from YougileTaskEditor.tsx (Phase 4).
// ──────────────────────────────────────────────────────────────────────────────

import { Clock } from 'lucide-react';
import { formatYougileTrackedHours } from '@/lib/yougile';

interface TimeTrackingSectionProps {
  plan?: number | null;
  work?: number | null;
}

export function TimeTrackingSection({ plan, work }: TimeTrackingSectionProps) {
  if (plan == null) return null;

  return (
    <div className="border-b border-zinc-800/30 px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Clock className="h-3 w-3 text-zinc-600" />
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Time Tracking
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-700">Plan</span>
          <span className="font-mono text-xs text-zinc-400">
            {formatYougileTrackedHours(plan)}
          </span>
        </div>
        <div className="h-8 w-px bg-zinc-800" />
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-700">Logged</span>
          <span className="font-mono text-xs text-zinc-400">
            {formatYougileTrackedHours(work ?? 0)}
          </span>
        </div>
        {work != null && (
          <>
            <div className="h-8 w-px bg-zinc-800" />
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-700">Left</span>
              <span className={`font-mono text-xs ${
                work > plan ? 'text-red-400' : 'text-zinc-400'
              }`}>
                {formatYougileTrackedHours(Math.max(0, plan - work))}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
