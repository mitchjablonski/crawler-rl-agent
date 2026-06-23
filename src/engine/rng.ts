// mulberry32: a tiny 32-bit PRNG whose entire state is one uint32, so RNG
// state serializes inside RunState and replays are exact (REQ-1, REQ-9).

export type RngState = number;

export function seedFromString(input: string): RngState {
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private s: number;

  constructor(state: RngState) {
    this.s = state >>> 0;
  }

  state(): RngState {
    return this.s;
  }

  /** Uniform float in [0, 1). Advances the stream. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Integer in [min, maxInclusive]. */
  intBetween(min: number, maxInclusive: number): number {
    return min + this.int(maxInclusive - min + 1);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on empty array');
    return items[this.int(items.length)] as T;
  }

  /** Fisher–Yates; returns a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }
}

// One stream per subsystem: a new consumer added later draws from its own
// stream and never reorders another subsystem's rolls.
export type StreamName = 'map' | 'combat' | 'loot' | 'events' | 'modifiers';

export type RngStreams = Readonly<Record<StreamName, RngState>>;

export function initStreams(seed: string): RngStreams {
  const root = seedFromString(seed);
  const derive = (label: StreamName) => (root ^ seedFromString(label)) >>> 0;
  return {
    map: derive('map'),
    combat: derive('combat'),
    loot: derive('loot'),
    events: derive('events'),
    modifiers: derive('modifiers'),
  };
}

/** Run fn against one stream; returns the result and the advanced streams. */
export function withStream<T>(
  streams: RngStreams,
  name: StreamName,
  fn: (rng: Rng) => T,
): [T, RngStreams] {
  const rng = new Rng(streams[name]);
  const result = fn(rng);
  return [result, { ...streams, [name]: rng.state() }];
}
