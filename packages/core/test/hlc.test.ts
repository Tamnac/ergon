import { describe, expect, it } from 'vitest';
import { Clock, formatHlc, parseHlc } from '../src';

describe('Clock', () => {
  it('increments the counter within the same millisecond', () => {
    const clock = new Clock('a', () => 1000);
    const first = clock.tick();
    const second = clock.tick();
    expect(second > first).toBe(true);
    expect(parseHlc(second)).toEqual({ ms: 1000, counter: 1, node: 'a' });
  });

  it('stays monotonic when the wall clock goes backwards', () => {
    let now = 5000;
    const clock = new Clock('a', () => now);
    const first = clock.tick();
    now = 1000;
    expect(clock.tick() > first).toBe(true);
  });

  it('orders after received timestamps from the future', () => {
    const clock = new Clock('a', () => 1000);
    const remote = formatHlc(9000, 3, 'b');
    clock.receive(remote);
    const next = clock.tick();
    expect(next > remote).toBe(true);
    expect(parseHlc(next)).toMatchObject({ ms: 9000, counter: 4 });
  });

  it('sorts as strings in time order', () => {
    const stamps = [formatHlc(35, 0, 'z'), formatHlc(36, 0, 'a'), formatHlc(36, 36, 'a')];
    expect(stamps.toReversed().toSorted()).toEqual(stamps);
  });
});
