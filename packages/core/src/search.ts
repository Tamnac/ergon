/** The lowercased words of a search query. A match contains all of them. */
export const searchWords = (query: string): string[] =>
  query.toLowerCase().split(/\s+/).filter(Boolean);

export const matchesWords = (text: string, words: readonly string[]): boolean => {
  const lower = text.toLowerCase();
  return words.every((word) => lower.includes(word));
};
