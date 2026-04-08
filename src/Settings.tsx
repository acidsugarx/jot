import { useEffect, useState, useRef } from 'react';
import { FolderOpen, Keyboard, Database, Palette, Users } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useTaskStore } from '@/store/use-task-store';
import { useYougileStore } from '@/store/use-yougile-store';
import { AccountsSettings } from '@/components/AccountsSettings';
import { focusEngine, dispatchFocusKey } from '@/lib/focus-engine';
import { resolveNormalKeyActions, useRegisteredNormalKeyActions } from '@/lib/focus-actions';
import { isTauriAvailable } from '@/lib/tauri';
import {
  consumeStoredSettingsTab,
  SETTINGS_NAVIGATION_EVENT,
  type SettingsNavigationPayload,
} from '@/lib/settings-navigation';
import type { AppSettings } from '@/types';

type Tab = 'general' | 'vault' | 'ui' | 'accounts';

const baseTabIds: Tab[] = ['general', 'vault', 'ui', 'accounts'];

const tabDefs: { id: Tab; label: string; icon: typeof Keyboard }[] = [
  { id: 'general', label: 'General', icon: Keyboard },
  { id: 'vault', label: 'Vault', icon: Database },
  { id: 'ui', label: 'Appearance', icon: Palette },
  { id: 'accounts', label: 'Accounts', icon: Users },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>(() => consumeStoredSettingsTab() ?? 'general');
  const [vaultDirInput, setVaultDirInput] = useState('');
  const isDialogOpenRef = useRef(false);
  const tabIdsRef = useRef<Tab[]>(baseTabIds);

  const { settings, fetchSettings, updateSettings, updateTheme } = useTaskStore();
  const yougileStore = useYougileStore();

  // Derive visible tabs based on yougileEnabled
  const tabIds: Tab[] = yougileStore.yougileEnabled
    ? [...baseTabIds]
    : baseTabIds;
  const tabs = tabDefs.filter((t) => tabIds.includes(t.id));
  tabIdsRef.current = tabIds;

  useEffect(() => {
    if (!tabIds.includes(activeTab)) {
      setActiveTab('general');
    }
  }, [activeTab, tabIds]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (settings?.vaultDir) {
      setVaultDirInput(settings.vaultDir);
    }
    // Sync yougileEnabled from backend settings into the store
    if (settings != null) {
      yougileStore.setYougileEnabled(settings.yougileEnabled);
    }
  }, [settings, yougileStore.setYougileEnabled]);

  useEffect(() => {
    if (!isTauriAvailable()) return;

    const unlisten = listen<SettingsNavigationPayload>(SETTINGS_NAVIGATION_EVENT, (event) => {
      const nextTab = event.payload.tab;
      setActiveTab(nextTab);
    }).catch(() => {});

    return () => {
      void unlisten.then((fn) => { if (typeof fn === 'function') fn(); }).catch(() => {});
    };
  }, []);

  const saveVaultPath = async (val: string) => {
    try {
      await updateSettings(val.trim() || null);
      await emit('settings-updated');
    } catch (err) {
      console.error(err);
    }
  };

  // Register settings pane with focus engine
  useEffect(() => {
    const engine = focusEngine.getState();
    engine.registerPane('settings', { regions: tabIdsRef.current, order: 0 });
    return () => {
      engine.unregisterPane('settings');
    };
  }, []);

  useRegisteredNormalKeyActions('settings:window', {
    onEscape: () => {
      if (focusEngine.getState().mode === 'NORMAL') {
        void getCurrentWindow().close();
      }
    },
  });

  // Focus-engine keydown handler — replaces inline addEventListener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') {
          (document.activeElement as HTMLElement).blur();
          e.preventDefault();
        }
        if (e.key === 'Tab') {
          e.preventDefault();
        }
        return;
      }

      // h/l switch tabs directly (settings-specific, not region navigation)
      if (e.key === 'h' || e.key === 'ArrowLeft') {
        e.preventDefault();
        setActiveTab((current) => {
          const ids = tabIdsRef.current;
          const idx = ids.indexOf(current);
          return ids[Math.max(0, idx - 1)] ?? current;
        });
        return;
      }
      if (e.key === 'l' || e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveTab((current) => {
          const ids = tabIdsRef.current;
          const idx = ids.indexOf(current);
          return ids[Math.min(ids.length - 1, idx + 1)] ?? current;
        });
        return;
      }

      // Dispatch remaining keys (Escape, Tab, etc.) through focus engine
      const result = dispatchFocusKey(focusEngine, e, resolveNormalKeyActions());
      if (result.handled) {
        if (result.stopPropagation) e.stopPropagation();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
        <div className="mx-auto max-w-[820px] px-6 py-6">

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
                    Integrations
                  </span>
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <div>
                    <div className="text-sm text-zinc-200">Yougile Integration</div>
                    <div className="text-xs text-zinc-500">Connect to Yougile for remote task management</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newValue = !yougileStore.yougileEnabled;
                      yougileStore.setYougileEnabled(newValue);
                      if (isTauriAvailable()) {
                        void invoke<AppSettings>('update_yougile_enabled', { enabled: newValue });
                        void emit('settings-updated');
                      }
                    }}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      yougileStore.yougileEnabled ? 'bg-cyan-500' : 'bg-zinc-700'
                    }`}
                  >
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      yougileStore.yougileEnabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
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

          {activeTab === 'accounts' && (
            <div>
              <div className="mb-3">
                <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                  Yougile Accounts
                </span>
              </div>
              <AccountsSettings />
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-zinc-800/40 px-4 py-1.5">
        <div className="flex items-center justify-between font-mono text-[10px] text-zinc-700">
          <div className="flex items-center gap-2">
            <span>h/l tabs</span>
            <span className="text-zinc-800">·</span>
            <span>esc close</span>
          </div>
          <span>auto-saves</span>
        </div>
      </div>
    </div>
  );
}
