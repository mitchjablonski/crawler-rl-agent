// Gym/Gymnasium-style environment wrapper around the engine. Bundles the pieces
// every script wired by hand — reset/step, observation encoding, the legal-action
// mask + decode table, done, and a (potential-shaped) reward — behind the standard
// RL interface. The dynamics are the pure deterministic engine; the env just frames it.
import { applyAction, createRun, type RunConfig } from '../engine/run.js';
import { DEFAULT_RUN_CONFIG } from '../engine/content/index.js';
import type { ContentRegistry, GameAction, RunState } from '../engine/types.js';
import { type Encoder, createEncoder } from './encode.js';
import { ACTION_SPACE, actionMask, slotOf } from './mask.js';

/** Potential Φ(s): progress toward the boss + hp fraction; 0 at terminal (telescopes). */
export function potential(state: RunState): number {
  if (state.phase === 'victory' || state.phase === 'defeat') return 0;
  const bossRow = state.map.nodes[state.map.bossId]?.row ?? 1;
  const depth = (state.map.nodes[state.currentNodeId]?.row ?? 0) / Math.max(1, bossRow);
  const hpFrac = state.maxHp > 0 ? state.hp / state.maxHp : 0;
  return depth * 0.6 + hpFrac * 0.2;
}

export interface Observation {
  /** Encoded state vector, length `observationSize`. */
  readonly obs: Float32Array;
  /** 1 = legal, 0 = illegal, length `actionSpace`. */
  readonly mask: Float32Array;
  /** slot -> GameAction (null if empty); decode a net argmax. */
  readonly actions: ReadonlyArray<GameAction | null>;
}

export interface StepResult extends Observation {
  readonly reward: number;
  readonly done: boolean;
  readonly info: { phase: string; won?: boolean; illegal?: boolean };
}

export interface CrawlerEnvOptions {
  readonly encoder?: Encoder;
  /** Add potential-based shaping γ·Φ(s') − Φ(s) to the terminal reward. Default true. */
  readonly rewardShaping?: boolean;
  readonly gamma?: number;
  readonly winReward?: number;
  readonly lossReward?: number;
}

/** Stateful single-episode environment. `reset` then `step` repeatedly until `done`. */
export class CrawlerEnv {
  readonly actionSpace = ACTION_SPACE;
  readonly observationSize: number;
  readonly encoder: Encoder;
  private readonly content: ContentRegistry;
  private readonly shaping: boolean;
  private readonly gamma: number;
  private readonly winReward: number;
  private readonly lossReward: number;
  private state: RunState | null = null;

  constructor(content: ContentRegistry, options: CrawlerEnvOptions = {}) {
    this.content = content;
    this.encoder = options.encoder ?? createEncoder(content);
    this.observationSize = this.encoder.size;
    this.shaping = options.rewardShaping ?? true;
    this.gamma = options.gamma ?? 1;
    this.winReward = options.winReward ?? 1;
    this.lossReward = options.lossReward ?? 0;
  }

  /** Current game state (read-only view), or null before reset. */
  get runState(): RunState | null {
    return this.state;
  }

  reset(seed: string, config: RunConfig = DEFAULT_RUN_CONFIG): Observation {
    this.state = createRun(this.content, seed, config);
    return this.observe(this.state);
  }

  /** Step by a GameAction. Illegal actions are a no-op with a small penalty (mask first). */
  step(action: GameAction): StepResult {
    if (!this.state) throw new Error('call reset() before step()');
    const prev = this.state;
    if (slotOf(prev, action) === null || !this.isLegal(prev, action)) {
      return { ...this.observe(prev), reward: -0.1, done: false, info: { phase: prev.phase, illegal: true } };
    }
    const next = applyAction(this.content, prev, action);
    this.state = next;
    const done = next.phase === 'victory' || next.phase === 'defeat';
    let reward = done ? (next.phase === 'victory' ? this.winReward : this.lossReward) : 0;
    if (this.shaping) reward += this.gamma * potential(next) - potential(prev);
    return {
      ...this.observe(next),
      reward,
      done,
      info: { phase: next.phase, won: done ? next.phase === 'victory' : undefined },
    };
  }

  /** Step by a flat action slot (decode from the current legal set) — for net-argmax agents. */
  stepSlot(slot: number): StepResult {
    if (!this.state) throw new Error('call reset() before stepSlot()');
    const { actions } = actionMask(this.content, this.state);
    const action = actions[slot];
    if (!action) {
      return { ...this.observe(this.state), reward: -0.1, done: false, info: { phase: this.state.phase, illegal: true } };
    }
    return this.step(action);
  }

  private isLegal(state: RunState, action: GameAction): boolean {
    const slot = slotOf(state, action);
    if (slot === null) return false;
    return (actionMask(this.content, state).mask[slot] ?? 0) > 0;
  }

  private observe(state: RunState): Observation {
    const { mask, actions } = actionMask(this.content, state);
    return { obs: this.encoder.encode(state), mask, actions };
  }
}
