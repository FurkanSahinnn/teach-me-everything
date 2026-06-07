export const SETUP_COMPLETE_STORAGE_KEY = "tme:setup-complete";

export function isSetupComplete(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SETUP_COMPLETE_STORAGE_KEY) === "1";
}

export function markSetupComplete(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SETUP_COMPLETE_STORAGE_KEY, "1");
}
