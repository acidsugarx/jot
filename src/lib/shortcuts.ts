function isWindowsPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Win/i.test(navigator.platform);
}

export function captureShortcutLabel(): string {
  return isWindowsPlatform() ? 'Ctrl+Space' : 'Opt+Space';
}

export function dashboardShortcutLabel(): string {
  return isWindowsPlatform() ? 'Ctrl+Shift+Space' : '⌘⇧Space';
}

export function settingsShortcutLabel(): string {
  return isWindowsPlatform() ? 'Ctrl+,' : '⌘,';
}
