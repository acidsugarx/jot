import { X } from 'lucide-react';

interface HotkeyCheatSheetProps {
  open: boolean;
  onClose: () => void;
  isYougile: boolean;
}

interface KeyBinding {
  key: string;
  action: string;
  yougileOnly?: boolean;
  localOnly?: boolean;
}

const categories: { title: string; items: KeyBinding[] }[] = [
  {
    title: 'Navigation',
    items: [
      { key: 'j / ↓', action: 'Next task' },
      { key: 'k / ↑', action: 'Previous task' },
      { key: 'h / ←', action: 'Prev column' },
      { key: 'l / →', action: 'Next column' },
      { key: 'g', action: 'First task' },
      { key: 'G', action: 'Last task' },
      { key: '/', action: 'Search' },
      { key: '1-4', action: 'Jump to column' },
    ],
  },
  {
    title: 'Actions',
    items: [
      { key: 'e / Enter', action: 'Edit task' },
      { key: 'x', action: 'Toggle done' },
      { key: 's', action: 'Cycle status', localOnly: true },
      { key: 'm', action: 'Move to next column' },
      { key: 'd', action: 'Delete task' },
      { key: 'n', action: 'New task' },
      { key: 'o', action: 'Open linked note', localOnly: true },
      { key: 'r', action: 'Refresh' },
    ],
  },
  {
    title: 'General',
    items: [
      { key: 'Esc', action: 'Close / Deselect' },
      { key: 'Tab', action: 'Switch source' },
      { key: '?', action: 'Show this help' },
    ],
  },
];

export function HotkeyCheatSheet({ open, onClose, isYougile }: HotkeyCheatSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50" onClick={onClose}>
      <div
        className="mt-24 w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Keyboard Shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4">
          {categories.map((cat) => (
            <div key={cat.title}>
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">{cat.title}</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                {cat.items
                  .filter((item) => {
                    if (item.yougileOnly && !isYougile) return false;
                    if (item.localOnly && isYougile) return false;
                    return true;
                  })
                  .map((item) => (
                    <div key={item.key} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-zinc-400">{item.action}</span>
                      <kbd className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-cyan-400">
                        {item.key}
                      </kbd>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
