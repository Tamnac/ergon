/**
 * Hybrid logical clock timestamp: `<ms base36>:<counter base36>:<node>`.
 * Fixed-width fields make string comparison equal to causal order.
 */
export type Hlc = string;

const TIME_WIDTH = 11;
const COUNT_WIDTH = 5;
const MAX_COUNT = 36 ** COUNT_WIDTH - 1;

export function formatHlc(ms: number, counter: number, node: string): Hlc {
  return `${ms.toString(36).padStart(TIME_WIDTH, '0')}:${counter.toString(36).padStart(COUNT_WIDTH, '0')}:${node}`;
}

export function parseHlc(hlc: Hlc): { ms: number; counter: number; node: string } {
  const [ms, counter, node] = hlc.split(':');
  if (!ms || !counter || !node) throw new Error(`Invalid HLC: ${hlc}`);
  return { ms: parseInt(ms, 36), counter: parseInt(counter, 36), node };
}

export function randomNode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class Clock {
  readonly node: string;
  readonly #now: () => number;
  #ms = 0;
  #counter = 0;

  constructor(node: string, now: () => number = Date.now) {
    this.node = node;
    this.#now = now;
  }

  tick(): Hlc {
    const wall = this.#now();
    if (wall > this.#ms) {
      this.#ms = wall;
      this.#counter = 0;
    } else if (this.#counter < MAX_COUNT) {
      this.#counter++;
    } else {
      throw new Error('HLC counter overflow');
    }
    return formatHlc(this.#ms, this.#counter, this.node);
  }

  /** Advance past a timestamp seen elsewhere so the next tick orders after it. */
  receive(remote: Hlc): void {
    const { ms, counter } = parseHlc(remote);
    if (ms > this.#ms || (ms === this.#ms && counter > this.#counter)) {
      this.#ms = ms;
      this.#counter = counter;
    }
  }
}
