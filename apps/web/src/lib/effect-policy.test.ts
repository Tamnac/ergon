import { describe, expect, it } from 'vitest';
import { celebrates, pickEffect, SOMETIMES_CHANCE } from './effect-policy';

const settings = (
  intensity: 'off' | 'subtle' | 'dramatic',
  frequency: 'always' | 'sometimes' | 'milestones',
) => ({
  intensity,
  frequency,
});

describe('celebrates', () => {
  it('never does when off', () => {
    for (const occasion of ['todo', 'section', 'column'] as const) {
      expect(celebrates(occasion, settings('off', 'always'))).toBe(false);
    }
  });

  it('always celebrates milestones', () => {
    for (const frequency of ['always', 'sometimes', 'milestones'] as const) {
      expect(celebrates('section', settings('subtle', frequency))).toBe(true);
      expect(celebrates('column', settings('dramatic', frequency))).toBe(true);
    }
  });

  it('celebrates plain todos by frequency', () => {
    expect(celebrates('todo', settings('subtle', 'always'))).toBe(true);
    expect(celebrates('todo', settings('subtle', 'milestones'), () => 0)).toBe(false);
    expect(celebrates('todo', settings('subtle', 'sometimes'), () => SOMETIMES_CHANCE - 0.01)).toBe(
      true,
    );
    expect(celebrates('todo', settings('subtle', 'sometimes'), () => SOMETIMES_CHANCE)).toBe(false);
  });
});

describe('pickEffect', () => {
  const names = ['hammer', 'stamp', 'shatter'];

  it('returns the chosen effect if it exists', () => {
    expect(pickEffect('stamp', names)).toBe('stamp');
    expect(pickEffect('explosion', names)).toBeNull();
  });

  it('picks any effect for random', () => {
    expect(pickEffect('random', names, () => 0)).toBe('hammer');
    expect(pickEffect('random', names, () => 0.99)).toBe('shatter');
    expect(pickEffect('random', [])).toBeNull();
  });
});
