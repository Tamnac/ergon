import { todayStr } from '@ergon/core';
import { createSignal } from 'solid-js';

const [today, setToday] = createSignal(todayStr());
export { today };

function scheduleMidnight() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  setTimeout(
    () => {
      setToday(todayStr());
      scheduleMidnight();
    },
    midnight.getTime() - now.getTime() + 1000,
  );
}

scheduleMidnight();
// Timers are throttled in background tabs.
document.addEventListener('visibilitychange', () => setToday(todayStr()));
