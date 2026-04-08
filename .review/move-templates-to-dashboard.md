# Move Templates to Dashboard

## Overview

Move the task template management UI from the Settings window (Templates tab) to the Dashboard window as a new tab alongside List/Board/Calendar. Templates are Yougile-specific, so the tab only appears when Yougile is the active source.

## Current State

- `TaskTemplatesSettings.tsx` — 859-line component in Settings window
- `use-template-store.ts` — Zustand store with CRUD via Tauri IPC (unchanged)
- Templates tab in Settings → remove after migration
- "Save as Template" flow from capture → currently opens Settings window → update to open Dashboard

## Changes

### 1. Add Templates tab to Dashboard

**File:** `src/Dashboard.tsx`

- Extend `Tab` type: `'list' | 'kanban' | 'calendar' | 'templates'`
- Add tab def: `{ id: 'templates', label: 'Templates', icon: FileText }`
- Only show tab when `isYougile` is true
- Import `TaskTemplatesSettings` and render when `activeTab === 'templates'`
- The Dashboard already has Yougile context (columns, stickers, board) loaded

### 2. Remove Templates tab from Settings

**File:** `src/Settings.tsx`

- Remove `'templates'` from `Tab` type and `tabDefs`
- Remove `TaskTemplatesSettings` import and render block
- Remove `templateIntentNonce` state and `consumeTemplateIntent` effect

### 3. Update "Save as Template" navigation from capture

**File:** `src/App.tsx`

- `openTemplatesSettings()` currently calls `invoke('open_settings_window')` → change to `invoke('open_dashboard_window')`
- Update `SETTINGS_NAVIGATION_EVENT` emit to include tab hint
- The Dashboard needs to consume the template intent on mount

### 4. Add template intent consumption to Dashboard

**File:** `src/Dashboard.tsx`

- Import `consumeTemplateIntent` from `src/lib/settings-navigation`
- On mount, check for pending template intent
- If intent exists, switch to templates tab and pre-fill the draft
- This replaces the Settings-based consumption

### 5. Update settings-navigation module

**File:** `src/lib/settings-navigation.ts`

- Rename or add a dashboard-specific event for template navigation
- Keep `persistTemplateIntent` / `consumeTemplateIntent` working — they're storage-based, not window-specific

## File Change Summary

| File | Action |
|------|--------|
| `src/Dashboard.tsx` | Add `'templates'` tab, import `TaskTemplatesSettings`, consume template intents |
| `src/Settings.tsx` | Remove Templates tab, imports, and intent handling |
| `src/App.tsx` | Update `openTemplatesSettings` to open dashboard window instead of settings |
| `src/lib/settings-navigation.ts` | May need minor updates for dashboard navigation event |

## What Does NOT Change

- `src/components/TaskTemplatesSettings.tsx` — component itself is unchanged, just rendered in Dashboard instead of Settings
- `src/store/use-template-store.ts` — store is unchanged
- `src-tauri/src/db.rs` — backend is unchanged
- Capture overlay template picker — unchanged, still works the same way
- Template data model — unchanged
