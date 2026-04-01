import { useFocusEngineStore } from '@/hooks/use-focus-engine';

function getModeLabel(mode: 'NORMAL' | 'INSERT' | 'COMMAND', commandInput: string) {
  if (mode === 'COMMAND') {
    return commandInput ? `[/ ${commandInput}]` : '[/]';
  }
  return `[${mode}]`;
}

export function ModeIndicator() {
  const mode = useFocusEngineStore((state) => state.mode);
  const commandInput = useFocusEngineStore((state) => state.commandInput);

  return (
    <div className="pointer-events-none fixed bottom-2 left-2 z-50 rounded border border-zinc-700/70 bg-zinc-900/90 px-2 py-1 font-mono text-[10px] font-medium tracking-wider text-zinc-300 dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-300">
      {getModeLabel(mode, commandInput)}
    </div>
  );
}
