/**
 * Global capture-keys block flag.
 * Set when the capture bar enters a picker mode so FocusProvider
 * defers keyboard interception.
 */

export let captureKeysBlocked = false;

export function setCaptureKeysBlocked(v: boolean): void {
  captureKeysBlocked = v;
}
