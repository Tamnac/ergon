/** A reminder time (`HH:MM`) as the user's locale writes it. */
export const formatTime = (time: string) =>
  new Date(2000, 0, 1, Number(time.slice(0, 2)), Number(time.slice(3))).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
