import { describe, expect, it } from 'vitest';
import { linkify } from './links';

describe('linkify', () => {
  it('keeps plain text', () => {
    expect(linkify('buy milk')).toEqual([{ text: 'buy milk' }]);
  });

  it('finds bare URLs without trailing punctuation', () => {
    expect(linkify('see https://example.com/a?b=1.')).toEqual([
      { text: 'see ' },
      { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { text: '.' },
    ]);
  });

  it('supports www and markdown links', () => {
    expect(linkify('[roadmap](https://x.io/r) and www.a.com')).toEqual([
      { text: 'roadmap', href: 'https://x.io/r' },
      { text: ' and ' },
      { text: 'www.a.com', href: 'https://www.a.com' },
    ]);
  });
});
