import { expect, it } from 'vitest';
import { readableOn } from './color';

it('picks readable text colors', () => {
  expect(readableOn('#ffffff')).toBe('#000000');
  expect(readableOn('#ffd400')).toBe('#000000');
  expect(readableOn('#6d28d9')).toBe('#ffffff');
  expect(readableOn('#000')).toBe('#ffffff');
});
