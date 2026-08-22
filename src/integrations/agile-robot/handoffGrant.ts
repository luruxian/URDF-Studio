export const HANDOFF_GRANT_STORAGE_KEY = 'robots_handoff_granted';

export function grantRobotsHandoff(): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  sessionStorage.setItem(HANDOFF_GRANT_STORAGE_KEY, '1');
}

export function isHandoffGranted(): boolean {
  if (typeof sessionStorage === 'undefined') {
    return false;
  }
  return sessionStorage.getItem(HANDOFF_GRANT_STORAGE_KEY) === '1';
}
