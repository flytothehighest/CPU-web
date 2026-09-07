import { invalidateResponseCache } from '@/api/request';

export function clearCommunityViewCaches() {
  invalidateResponseCache();
  try {
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = storage.length - 1; index >= 0; index--) {
        const key = storage.key(index) || '';
        if (['cpu-home-summary-v1:', 'cpu-home-second-hand-v1:', 'cpu-profile-view-v1:', 'cpu-forum-pending-reply:'].some((prefix) => key.startsWith(prefix))) storage.removeItem(key);
      }
    }
  } catch { /* Storage can be unavailable; memory caches are already cleared. */ }
}
