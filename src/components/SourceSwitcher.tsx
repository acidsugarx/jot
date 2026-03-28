import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Monitor, Cloud, ChevronDown } from 'lucide-react';
import { useYougileStore } from '@/store/use-yougile-store';

export function SourceSwitcher() {
  const {
    activeSource,
    setActiveSource,
    yougileEnabled,
    fetchAccounts,
    accounts,
    yougileContext,
    setYougileContext,
    fetchProjects,
    error,
    isLoading,
  } = useYougileStore();
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker on outside click
  useEffect(() => {
    if (!showAccountPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowAccountPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAccountPicker]);

  if (!yougileEnabled) return null;

  const statusDot = error
    ? 'bg-red-400'
    : isLoading
      ? 'bg-yellow-400 animate-pulse'
      : 'bg-emerald-400';

  const activeAccount = accounts.find((a) => a.id === yougileContext.accountId);

  const handleOpenAccountPicker = async () => {
    if (accounts.length === 0) {
      await fetchAccounts();
    }

    if (useYougileStore.getState().accounts.length === 0) {
      await invoke('open_settings_window');
      return;
    }

    setShowAccountPicker((v) => !v);
  };

  const handleSourceToggle = async () => {
    if (activeSource === 'local') {
      if (accounts.length === 0) {
        await fetchAccounts();
      }
      if (useYougileStore.getState().accounts.length === 0) {
        await invoke('open_settings_window');
        return;
      }
      setActiveSource('yougile');
      return;
    }

    setActiveSource('local');
  };

  const handleSwitchAccount = async (accountId: string) => {
    setShowAccountPicker(false);
    if (accountId === yougileContext.accountId) {
      setActiveSource('yougile');
      return;
    }

    setYougileContext({
      accountId,
      projectId: null,
      projectName: null,
      boardId: null,
      boardName: null,
    });
    setActiveSource('yougile');
    await fetchProjects();
  };

  return (
    <div className="relative flex items-center gap-1" ref={pickerRef}>
      {/* Main source toggle */}
      <button
        type="button"
        onClick={() => void handleSourceToggle()}
        className={`flex items-center gap-1 rounded-l border px-2 py-1 text-xs transition-colors ${
          activeSource === 'yougile'
            ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400'
            : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600'
        }`}
      >
        {activeSource === 'local' ? <Monitor size={12} /> : <Cloud size={12} />}
        {activeSource === 'yougile' && (
          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusDot}`} />
        )}
        {activeSource === 'local' ? 'Local' : (activeAccount?.companyName ?? 'Yougile')}
      </button>

      {/* Organization picker stays available in local mode so source + org can be chosen explicitly */}
      <button
        type="button"
        onClick={() => void handleOpenAccountPicker()}
        className={`flex items-center gap-1 rounded-r border border-l-0 px-1.5 py-1 text-xs transition-colors ${
          activeSource === 'yougile'
            ? showAccountPicker
              ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400'
              : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400/60 hover:text-cyan-400'
            : showAccountPicker
              ? 'border-zinc-600 bg-zinc-800 text-zinc-300'
              : 'border-zinc-700 bg-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
        }`}
        title="Choose Yougile organization"
      >
        <span className="font-mono text-[10px] uppercase tracking-wide">Org</span>
        <ChevronDown size={10} className={`transition-transform ${showAccountPicker ? 'rotate-180' : ''}`} />
      </button>

      {/* Account dropdown */}
      {showAccountPicker && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
          {accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => void handleSwitchAccount(account.id)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                account.id === yougileContext.accountId
                  ? 'bg-cyan-500/10 text-cyan-300'
                  : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              <Cloud size={10} className={account.id === yougileContext.accountId ? 'text-cyan-400' : 'text-zinc-500'} />
              <span className="min-w-0 flex-1 truncate">{account.companyName}</span>
              {account.id === yougileContext.accountId && (
                <span className="shrink-0 text-cyan-400">✓</span>
              )}
            </button>
          ))}
          <div className="border-t border-zinc-800 px-3 py-2 text-[10px] text-zinc-600">
            Saved organizations only.
          </div>
        </div>
      )}
    </div>
  );
}
