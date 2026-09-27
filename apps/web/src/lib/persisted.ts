import { createSignal, type Accessor } from 'solid-js';

/** Signal mirrored to localStorage. For per-device UI state that doesn't sync. */
export function persistedSignal<T>(key: string, initial: T): [Accessor<T>, (value: T) => void] {
  const stored = localStorage.getItem(key);
  const [get, set] = createSignal<T>(stored === null ? initial : (JSON.parse(stored) as T));
  return [
    get,
    (value) => {
      set(() => value);
      localStorage.setItem(key, JSON.stringify(value));
    },
  ];
}
