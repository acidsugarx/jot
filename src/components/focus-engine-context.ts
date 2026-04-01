import { createContext } from 'react';
import type { StoreApi } from 'zustand/vanilla';

import type { FocusState } from '@/lib/focus-engine';

export const FocusEngineContext = createContext<StoreApi<FocusState> | null>(null);
