import { expect, it } from 'vitest';
import { accentTexts, readableOn } from './color';

it('picks readable text colors', () => {
  expect(readableOn('#ffffff')).toBe('#000000');
  expect(readableOn('#ffd400')).toBe('#000000');
  expect(readableOn('#6d28d9')).toBe('#ffffff');
  expect(readableOn('#000')).toBe('#ffffff');
});

it('keeps an accent that reads as text and adjusts one that does not', () => {
  expect(accentTexts('#6d28d9').light).toBe('#6d28d9');
  expect(accentTexts('#ca8a04').light).not.toBe('#ca8a04');
  expect(accentTexts('#6d28d9').dark).not.toBe('#6d28d9');
  expect(accentTexts('#ffd400').dark).toBe('#ffd400');
});

it('moves toward black on light surfaces and toward white on dark ones', () => {
  const channel = (hex: string) => parseInt(hex.slice(1, 3), 16);
  const { light, dark } = accentTexts('#2563eb');
  expect(channel(light)).toBeLessThanOrEqual(channel('#2563eb'));
  expect(channel(dark)).toBeGreaterThan(channel('#2563eb'));
  expect(accentTexts('nonsense')).toEqual({ light: 'nonsense', dark: 'nonsense' });
});
