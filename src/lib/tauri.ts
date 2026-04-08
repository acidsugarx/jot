export function isTauriAvailable(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

export function withTauriFallback<T>(fallback: T): T | undefined {
  return isTauriAvailable() ? undefined : fallback;
}
