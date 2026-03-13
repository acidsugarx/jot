import { useEffect, useState, useRef } from 'react';
import { FolderOpen, Settings as SettingsIcon, Database, Layout } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';
import { Button } from '@/components/ui/button';
import { useTaskStore } from '@/store/use-task-store';

type Tab = 'general' | 'vault' | 'ui';

export default function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [vaultDirInput, setVaultDirInput] = useState('');
  const isDialogOpenRef = useRef(false);

  const { settings, fetchSettings, updateSettings } = useTaskStore();

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
      if (win) {
        void win.setFocus();
      }

      if (typeof selected === 'string') {
        setVaultDirInput(selected);
        void saveVaultPath(selected);
      }
    } catch (err) {
      isDialogOpenRef.current = false;
      console.error(err);
    }
  };

  const tabs = [
    { id: 'general', label: 'General', icon: SettingsIcon },
    { id: 'vault', label: 'Vault', icon: Database },
    { id: 'ui', label: 'Appearance', icon: Layout },
  ];

  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-900 font-sans text-zinc-100 selection:bg-cyan-500/30">
      
      {/* 
        Native Titlebar Region 
        Padding top allows macOS traffic lights to overlay cleanly.
        data-tauri-drag-region lets the user click-and-drag the window.
      */}
      <div 
        data-tauri-drag-region 
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).hasAttribute('data-tauri-drag-region')) {
            void getCurrentWindow().startDragging();
          }
        }}
        className="flex shrink-0 flex-col items-center border-b border-zinc-800 bg-zinc-900/80 pt-8 shadow-sm backdrop-blur-md"
      >
        <div data-tauri-drag-region className="flex gap-2 pb-4 pointer-events-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as Tab)}
                className={`flex pointer-events-auto flex-col items-center justify-center gap-1.5 rounded-lg px-4 py-2 transition-all ${
                  isActive
                    ? 'bg-zinc-800/80 text-zinc-100 shadow-sm'
                    : 'text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300'
                }`}
              >
                <Icon className={`h-5 w-5 ${isActive ? 'text-cyan-400' : ''}`} />
                <span className="text-xs font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto px-12 py-8 bg-zinc-900">
        <div className="mx-auto max-w-2xl space-y-8">
          
          {activeTab === 'general' && (
            <div className="space-y-6">
              <div className="grid grid-cols-[140px_1fr] items-center gap-6">
                <span className="text-right text-sm font-medium text-zinc-400">Toggle Bar</span>
                <div className="flex">
                  <span className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-mono tracking-wider text-zinc-300 shadow-inner">
                    Opt + Space
                  </span>
                </div>
              </div>
              
              <div className="grid grid-cols-[140px_1fr] items-center gap-6">
                <span className="text-right text-sm font-medium text-zinc-400">Settings</span>
                <div className="flex">
                  <span className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-mono tracking-wider text-zinc-300 shadow-inner">
                    Cmd + ,
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'vault' && (
            <div className="space-y-6">
              <div className="grid grid-cols-[140px_1fr] items-baseline gap-6">
                <span className="text-right text-sm font-medium text-zinc-400">Vault Path</span>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={vaultDirInput}
                      onChange={(e) => setVaultDirInput(e.target.value)}
                      onBlur={() => void saveVaultPath(vaultDirInput)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveVaultPath(vaultDirInput);
                      }}
                      placeholder="/Users/you/Documents/Obsidian/MyVault"
                      className="flex h-9 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                    />
                    <Button
                      type="button"
                      onClick={() => void handleChooseVaultDir()}
                      variant="outline"
                      className="h-9 shrink-0 gap-2 border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
                    >
                      <FolderOpen className="h-4 w-4" />
                      Browse
                    </Button>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Target directory used by the `@zettel` command. Changes save automatically.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ui' && (
            <div className="space-y-6">
              <div className="grid grid-cols-[140px_1fr] items-center gap-6">
                <span className="text-right text-sm font-medium text-zinc-400">Theme</span>
                <div className="flex items-center gap-4">
                  {/* Mock options for Raycast aesthetic */}
                  <div className="flex flex-col items-center gap-2 cursor-pointer opacity-50">
                    <div className="h-12 w-16 rounded-md border border-zinc-700 bg-zinc-100"></div>
                    <span className="text-xs text-zinc-500">Light</span>
                  </div>
                  <div className="flex flex-col items-center gap-2 cursor-pointer">
                    <div className="h-12 w-16 rounded-md border-2 border-cyan-500 bg-zinc-950"></div>
                    <span className="text-xs font-medium text-zinc-200">Dark</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          
        </div>
      </div>
    </div>
  );
}
