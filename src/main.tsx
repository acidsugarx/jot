import React from 'react';
import ReactDOM from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';

import App from './App';
import Settings from './Settings';
import Dashboard from './Dashboard';
import './styles.css';

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
