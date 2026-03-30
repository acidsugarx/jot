import React from 'react';
import ReactDOM from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';

import App from './App';
import Settings from './Settings';
import Dashboard from './Dashboard';
import { useYougileStore } from './store/use-yougile-store';
import type { AppSettings } from './types';
import './styles.css';

const label = '__TAURI_INTERNALS__' in window ? getCurrentWindow().label : 'main';

// Apply saved theme before render to avoid flash
if ('__TAURI_INTERNALS__' in window) {
  invoke<AppSettings>('get_settings')
    .then((settings) => {
      document.documentElement.setAttribute('data-theme', settings.theme);
      void getCurrentWindow().setTheme(settings.theme === 'light' ? 'light' : 'dark');
    })
    .catch(() => {});

  // Only init Yougile sync for windows that need it (not settings)
  if (label !== 'settings') {
    void useYougileStore.getState().hydrateSyncState();
    const unlistenSync = useYougileStore.getState().listenForSyncUpdates();
    const unlistenTasks = useYougileStore.getState().listenForTaskUpdates();

    if (import.meta.hot) {
      import.meta.hot.dispose(() => {
        unlistenSync();
        unlistenTasks();
      });
    }
  }
}

let Page = <App />;
if (label === 'settings') {
  Page = <Settings />;
} else if (label === 'dashboard') {
  Page = <Dashboard />;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {Page}
  </React.StrictMode>
);
