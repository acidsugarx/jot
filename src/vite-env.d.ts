/// <reference types="vite/client" />

import type { NormalKeyActions } from '@/lib/focus-engine';

declare global {
  interface Window {
    __jotActions?: NormalKeyActions;
  }
}
