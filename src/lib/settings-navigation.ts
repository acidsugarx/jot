import type { YougileChecklist } from '@/types/yougile';

export type SettingsTab = 'general' | 'vault' | 'ui' | 'templates' | 'accounts';

export interface TemplateNavigationDraft {
  title: string;
  description?: string | null;
  color?: string | null;
  checklists?: YougileChecklist[];
  stickers?: Record<string, string>;
  columnId?: string | null;
}

export interface TemplateNavigationIntent {
  mode: 'new';
  draft?: TemplateNavigationDraft;
}

export interface SettingsNavigationPayload {
  tab: SettingsTab;
  templateIntent?: TemplateNavigationIntent;
}

export const SETTINGS_NAVIGATION_EVENT = 'settings-navigation';

const SETTINGS_TAB_STORAGE_KEY = 'jot:settings:tab';
const TEMPLATE_INTENT_STORAGE_KEY = 'jot:settings:template-intent';

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function persistSettingsTab(tab: SettingsTab): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, tab);
}

export function consumeStoredSettingsTab(): SettingsTab | null {
  if (!canUseStorage()) return null;
  const value = window.localStorage.getItem(SETTINGS_TAB_STORAGE_KEY) as SettingsTab | null;
  window.localStorage.removeItem(SETTINGS_TAB_STORAGE_KEY);
  return value;
}

export function persistTemplateIntent(intent: TemplateNavigationIntent): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(TEMPLATE_INTENT_STORAGE_KEY, JSON.stringify(intent));
}

export function consumeTemplateIntent(): TemplateNavigationIntent | null {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(TEMPLATE_INTENT_STORAGE_KEY);
  window.localStorage.removeItem(TEMPLATE_INTENT_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as TemplateNavigationIntent;
  } catch {
    return null;
  }
}
