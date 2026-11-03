/** Returns the packaged brand mark URL when running inside the extension. */
export function getBrandMarkUrl(): string | null {
  if (typeof chrome === 'undefined' || typeof chrome.runtime?.getURL !== 'function') {
    return null;
  }

  try {
    return chrome.runtime.getURL('branding/logo-small.svg');
  } catch {
    // The extension context can be unavailable in isolated tests or after reload.
    return null;
  }
}
