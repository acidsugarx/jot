import React from 'react';
import ReactDOM from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';

import App from './App';
import Settings from './Settings';
import Dashboard from './Dashboard';
import type { AppSettings } from './types';
import './styles.css';

// Apply saved theme before render to avoid flash
if ('__TAURI_INTERNALS__' in window) {
  invoke<AppSettings>('get_settings')
    .then((settings) => {
      document.documentElement.setAttribute('data-theme', settings.theme);
      // Set native window theme for macOS title bar
      void getCurrentWindow().setTheme(settings.theme === 'light' ? 'light' : 'dark');
    })
    .catch(() => {});
}

const label = getCurrentWindow().label;

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
