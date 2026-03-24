import { useEffect, useState, useRef } from 'react';
import { FolderOpen, Keyboard, Database, Palette } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';
import { useTaskStore } from '@/store/use-task-store';

type Tab = 'general' | 'vault' | 'ui';

const tabs: { id: Tab; label: string; icon: typeof Keyboard }[] = [
  { id: 'general', label: 'General', icon: Keyboard },
  { id: 'vault', label: 'Vault', icon: Database },
  { id: 'ui', label: 'Appearance', icon: Palette },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [vaultDirInput, setVaultDirInput] = useState('');
  const isDialogOpenRef = useRef(false);

  const { settings, fetchSettings, updateSettings, updateTheme } = useTaskStore();

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (settings?.vaultDir) {
      setVaultDirInput(settings.vaultDir);
    }
  }, [settings]);

  const saveVaultPath = async (val: string) => {
    try {
      await updateSettings(val.trim() || null);
      await emit('settings-updated');
    } catch (err) {
      console.error(err);
    }
  };

  const handleChooseVaultDir = async () => {
    try {
      isDialogOpenRef.current = true;
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Choose Jot vault folder',
      });
      isDialogOpenRef.current = false;

      const win = getCurrentWindow();
      if (win) void win.setFocus();

      if (typeof selected === 'string') {
        setVaultDirInput(selected);
        void saveVaultPath(selected);
      }
    } catch (err) {
      isDialogOpenRef.current = false;
      console.error(err);
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-[#111111] font-sans text-zinc-100 selection:bg-cyan-500/30">
      {/* Header — matches dashboard style */}
      <div
        data-tauri-drag-region
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).hasAttribute('data-tauri-drag-region')) {
            void getCurrentWindow().startDragging();
          }
        }}
        className="flex h-11 shrink-0 items-center justify-between border-b border-zinc-800/60 bg-[#161616]/80 px-4 backdrop-blur-md pl-[80px]"
      >
        <div data-tauri-drag-region className="flex items-center gap-1 pointer-events-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pointer-events-auto flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Icon className={`h-3 w-3 ${isActive ? 'text-cyan-400' : ''}`} />
                {tab.label}
              </button>
            );
          })}
        </div>

        <span className="font-mono text-[10px] text-zinc-600">settings</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl py-6 px-6">

          {activeTab === 'general' && (
            <div className="space-y-1">
              <div className="mb-3">
                <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                  Shortcuts
                </span>
              </div>

              <div className="flex h-9 items-center justify-between px-3">
                <span className="text-sm text-zinc-300">Quick Capture</span>
                <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                  Opt+Space
                </kbd>
              </div>

              <div className="flex h-9 items-center justify-between px-3">
                <span className="text-sm text-zinc-300">Dashboard</span>
                <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                  ⌘⇧Space
                </kbd>
              </div>

              <div className="flex h-9 items-center justify-between px-3">
                <span className="text-sm text-zinc-300">Settings</span>
                <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                  ⌘,
                </kbd>
              </div>

              <div className="border-t border-zinc-800/40 mt-4 pt-4">
                <div className="mb-3">
                  <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                    Vim Bindings (Dashboard)
                  </span>
                </div>
                {[
                  ['j / k', 'Navigate up/down'],
                  ['h / l', 'Navigate columns'],
                  ['e', 'Open editor'],
                  ['x', 'Toggle done'],
                  ['s', 'Cycle status'],
                  ['a', 'Archive / unarchive'],
                  ['d', 'Delete task'],
                  ['o', 'Open linked note'],
                  ['/', 'Focus search'],
                  ['esc', 'Close / deselect'],
                ].map(([key, desc]) => (
                  <div key={key} className="flex h-8 items-center justify-between px-3">
                    <span className="text-sm text-zinc-400">{desc}</span>
                    <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600">
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'vault' && (
            <div>
              <div className="mb-3">
                <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                  Zettelkasten Vault
                </span>
              </div>

              <div className="rounded-md border border-zinc-800/40 bg-[#161616] p-4 space-y-3">
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                    Vault Directory
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={vaultDirInput}
                      onChange={(e) => setVaultDirInput(e.target.value)}
                      onBlur={() => void saveVaultPath(vaultDirInput)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void saveVaultPath(vaultDirInput); }}
                      placeholder="/path/to/obsidian/vault"
                      className="h-8 min-w-0 flex-1 rounded-md border border-zinc-800 bg-[#111111] px-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-700 focus:border-cyan-500/40 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void handleChooseVaultDir()}
                      className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-zinc-800 bg-[#111111] px-3 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
                    >
                      <FolderOpen className="h-3 w-3" />
                      Browse
                    </button>
                  </div>
                </div>

                <p className="font-mono text-[10px] text-zinc-700">
                  Used by the <span className="text-cyan-600">@zettel</span> command to create linked notes. Auto-saves on blur.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'ui' && (
            <div>
              <div className="mb-3">
                <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                  Theme
                </span>
              </div>

              <div className="flex items-center gap-3 px-3">
                <button
                  type="button"
                  onClick={() => void updateTheme('dark')}
                  className={`flex flex-col items-center gap-1.5 rounded-md border-2 p-2 transition-colors ${
                    settings?.theme !== 'light' ? 'border-cyan-500/40' : 'border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className="h-8 w-12 rounded border" style={{ backgroundColor: '#111111', borderColor: '#27272a' }} />
                  <span className="font-mono text-[10px] text-zinc-200">Dark</span>
                </button>
                <button
                  type="button"
                  onClick={() => void updateTheme('light')}
                  className={`flex flex-col items-center gap-1.5 rounded-md border-2 p-2 transition-colors ${
                    settings?.theme === 'light' ? 'border-cyan-500/40' : 'border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className="h-8 w-12 rounded border" style={{ backgroundColor: '#f4f4f5', borderColor: '#d4d4d8' }} />
                  <span className="font-mono text-[10px] text-zinc-600">Light</span>
                </button>
              </div>

              <p className="mt-3 px-3 font-mono text-[10px] text-zinc-700">
                Theme applies to all windows instantly.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-zinc-800/40 px-4 py-1.5">
        <div className="flex items-center justify-between font-mono text-[10px] text-zinc-700">
          <span>jot v0.1.0</span>
          <span>changes save automatically</span>
        </div>
      </div>
    </div>
  );
}
