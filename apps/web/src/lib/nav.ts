import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/** True when the previous history entry is a page of this app (React Router keeps an index in history.state). */
export const hasInAppHistory = () => ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;

/**
 * Back that never leaves the app: a screen opened directly (link, bookmark, "Send to TV", app start)
 * goes to `fallback` instead of the previous website — leaving would also cut off pending writes.
 */
export function useGoBack() {
  const nav = useNavigate();
  return useCallback((fallback = '/') => (hasInAppHistory() ? nav(-1) : nav(fallback, { replace: true })), [nav]);
}
