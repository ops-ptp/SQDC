import { useEffect, useState } from 'react';
import { format } from 'date-fns';

/**
 * Today's date as 'yyyy-MM-dd' (the device's local day), updating itself
 * just after midnight and whenever the tab becomes visible again — so a
 * board left open on a TV overnight, or a laptop woken from sleep, moves
 * on to the new day instead of reviewing yesterday's forever.
 */
export function useTodayString(): string {
  const [today, setToday] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  useEffect(() => {
    const check = () => setToday(format(new Date(), 'yyyy-MM-dd'));
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    const timer = window.setTimeout(check, nextMidnight.getTime() - now.getTime());
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [today]);
  return today;
}
