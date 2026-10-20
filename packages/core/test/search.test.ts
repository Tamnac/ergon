import { describe, expect, it } from 'vitest';
import { matchesWords, searchWords } from '../src';

describe('search', () => {
  it('splits a query into lowercase words', () => {
    expect(searchWords('  Buy   MILK ')).toEqual(['buy', 'milk']);
    expect(searchWords(' ')).toEqual([]);
  });

  it('matches texts containing every word', () => {
    const words = searchWords('milk buy');
    expect(matchesWords('Buy oat MILK', words)).toBe(true);
    expect(matchesWords('Buy bread', words)).toBe(false);
  });
});
