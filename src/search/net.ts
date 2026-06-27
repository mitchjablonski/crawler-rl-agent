// Policy + value MLP. Hand-rolled (no external runtime) because the content is
// tiny and CPU-bound. Params are plain number[] so the net JSON-serializes
// straight into a Checkpoint alongside the vocab manifest. The value head is
// squashed to [0,1] to match the engine's value() range (victory = 1), so it can
// replace the MCTS rollout at leaf nodes.

export const DEFAULT_HIDDEN = 128;

export interface NetConfig {
  readonly inputSize: number;
  readonly actionSize: number;
  readonly hidden: number;
}

export interface NetParams {
  readonly config: NetConfig;
  readonly w1: number[]; // hidden * inputSize, row-major
  readonly b1: number[]; // hidden
  readonly wPolicy: number[]; // actionSize * hidden, row-major
  readonly bPolicy: number[]; // actionSize
  readonly wValue: number[]; // hidden
  readonly bValue: number; // scalar
}

export interface NetOutput {
  /** Raw policy logits, length actionSize. Apply the action mask before softmax. */
  readonly policy: Float32Array;
  /** Squashed value estimate in [0,1]. */
  readonly value: number;
}

function xavier(fanIn: number, fanOut: number, rand: () => number): number {
  const limit = Math.sqrt(6 / (fanIn + fanOut));
  return (rand() * 2 - 1) * limit;
}

/** Deep copy of a net's parameters — snapshot it before further in-place trainStep mutation. */
export function cloneNet(net: NetParams): NetParams {
  return {
    config: net.config,
    w1: [...net.w1],
    b1: [...net.b1],
    wPolicy: [...net.wPolicy],
    bPolicy: [...net.bPolicy],
    wValue: [...net.wValue],
    bValue: net.bValue,
  };
}

/** Random-initialised net. `rand` is injected so init is reproducible. */
export function createNet(config: NetConfig, rand: () => number): NetParams {
  const { inputSize, actionSize, hidden } = config;
  return {
    config,
    w1: Array.from({ length: hidden * inputSize }, () => xavier(inputSize, hidden, rand)),
    b1: new Array<number>(hidden).fill(0),
    wPolicy: Array.from({ length: actionSize * hidden }, () => xavier(hidden, actionSize, rand)),
    bPolicy: new Array<number>(actionSize).fill(0),
    wValue: Array.from({ length: hidden }, () => xavier(hidden, 1, rand)),
    bValue: 0,
  };
}

const relu = (x: number): number => (x > 0 ? x : 0);
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** Forward pass: x (length inputSize) -> { policy logits, value in [0,1] }. */
export function forward(net: NetParams, x: Float32Array): NetOutput {
  const { inputSize, actionSize, hidden } = net.config;
  const h = new Float32Array(hidden);
  for (let j = 0; j < hidden; j++) {
    let sum = net.b1[j] ?? 0;
    const base = j * inputSize;
    for (let i = 0; i < inputSize; i++) sum += (net.w1[base + i] ?? 0) * (x[i] ?? 0);
    h[j] = relu(sum);
  }
  const policy = new Float32Array(actionSize);
  for (let a = 0; a < actionSize; a++) {
    let sum = net.bPolicy[a] ?? 0;
    const base = a * hidden;
    for (let j = 0; j < hidden; j++) sum += (net.wPolicy[base + j] ?? 0) * (h[j] ?? 0);
    policy[a] = sum;
  }
  let v = net.bValue;
  for (let j = 0; j < hidden; j++) v += (net.wValue[j] ?? 0) * (h[j] ?? 0);
  return { policy, value: sigmoid(v) };
}

/**
 * PUCT priors: softmax over legal logits (illegal slots -> 0). Sums to 1 across
 * legal actions; returns all-zeros if nothing is legal.
 */
export function policyPriors(logits: Float32Array, mask: Float32Array): Float32Array {
  const n = logits.length;
  const out = new Float32Array(n);
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    if ((mask[i] ?? 0) > 0 && (logits[i] ?? 0) > max) max = logits[i] ?? 0;
  }
  if (max === -Infinity) return out; // no legal actions
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if ((mask[i] ?? 0) > 0) {
      const e = Math.exp((logits[i] ?? 0) - max);
      out[i] = e;
      sum += e;
    }
  }
  if (sum > 0) for (let i = 0; i < n; i++) out[i] = (out[i] ?? 0) / sum;
  return out;
}

// ---- Training: backprop + SGD ----

export interface TrainSample {
  /** Input observation, length inputSize. */
  readonly x: Float32Array;
  /** Target policy over slots (illegal = 0, sums to 1), length actionSize. */
  readonly pi: Float32Array;
  /** Legal-action mask, length actionSize. */
  readonly mask: Float32Array;
  /** Value target in [0,1] (episode outcome). */
  readonly z: number;
}

export interface TrainStats {
  readonly loss: number;
  readonly policyLoss: number;
  readonly valueLoss: number;
}

/**
 * One SGD step over a batch. MUTATES `net` weights in place. Loss is masked
 * policy cross-entropy (target π) + value MSE (target z), averaged over the
 * batch. `l2` applies decoupled weight decay to the weight matrices.
 */
export function trainStep(
  net: NetParams,
  batch: readonly TrainSample[],
  lr: number,
  l2 = 0,
): TrainStats {
  const { inputSize, actionSize, hidden } = net.config;
  const gW1 = new Float64Array(hidden * inputSize);
  const gb1 = new Float64Array(hidden);
  const gWP = new Float64Array(actionSize * hidden);
  const gbP = new Float64Array(actionSize);
  const gWV = new Float64Array(hidden);
  let gbV = 0;
  let policyLoss = 0;
  let valueLoss = 0;

  for (const s of batch) {
    const hPre = new Float64Array(hidden);
    const h = new Float64Array(hidden);
    for (let j = 0; j < hidden; j++) {
      let sum = net.b1[j] ?? 0;
      const base = j * inputSize;
      for (let i = 0; i < inputSize; i++) sum += (net.w1[base + i] ?? 0) * (s.x[i] ?? 0);
      hPre[j] = sum;
      h[j] = sum > 0 ? sum : 0;
    }
    const logits = new Float64Array(actionSize);
    for (let a = 0; a < actionSize; a++) {
      let sum = net.bPolicy[a] ?? 0;
      const base = a * hidden;
      for (let j = 0; j < hidden; j++) sum += (net.wPolicy[base + j] ?? 0) * (h[j] ?? 0);
      logits[a] = sum;
    }
    const p = new Float64Array(actionSize);
    let max = -Infinity;
    for (let a = 0; a < actionSize; a++) {
      if ((s.mask[a] ?? 0) > 0 && (logits[a] ?? 0) > max) max = logits[a] ?? 0;
    }
    if (max > -Infinity) {
      let zs = 0;
      for (let a = 0; a < actionSize; a++) {
        if ((s.mask[a] ?? 0) > 0) {
          const e = Math.exp((logits[a] ?? 0) - max);
          p[a] = e;
          zs += e;
        }
      }
      if (zs > 0) for (let a = 0; a < actionSize; a++) p[a] = (p[a] ?? 0) / zs;
    }
    let vPre = net.bValue;
    for (let j = 0; j < hidden; j++) vPre += (net.wValue[j] ?? 0) * (h[j] ?? 0);
    const v = 1 / (1 + Math.exp(-vPre));

    for (let a = 0; a < actionSize; a++) {
      const t = s.pi[a] ?? 0;
      if (t > 0) policyLoss += -t * Math.log((p[a] ?? 0) || 1e-12);
    }
    valueLoss += (v - s.z) * (v - s.z);

    const dValuePre = 2 * (v - s.z) * v * (1 - v);
    const dLogit = new Float64Array(actionSize);
    for (let a = 0; a < actionSize; a++) {
      dLogit[a] = (s.mask[a] ?? 0) > 0 ? (p[a] ?? 0) - (s.pi[a] ?? 0) : 0;
    }
    const dhPre = new Float64Array(hidden);
    for (let j = 0; j < hidden; j++) {
      let g = dValuePre * (net.wValue[j] ?? 0);
      for (let a = 0; a < actionSize; a++) g += (dLogit[a] ?? 0) * (net.wPolicy[a * hidden + j] ?? 0);
      dhPre[j] = (hPre[j] ?? 0) > 0 ? g : 0;
    }
    for (let a = 0; a < actionSize; a++) {
      const d = dLogit[a] ?? 0;
      gbP[a] = (gbP[a] ?? 0) + d;
      const base = a * hidden;
      for (let j = 0; j < hidden; j++) gWP[base + j] = (gWP[base + j] ?? 0) + d * (h[j] ?? 0);
    }
    for (let j = 0; j < hidden; j++) gWV[j] = (gWV[j] ?? 0) + dValuePre * (h[j] ?? 0);
    gbV += dValuePre;
    for (let j = 0; j < hidden; j++) {
      const d = dhPre[j] ?? 0;
      gb1[j] = (gb1[j] ?? 0) + d;
      const base = j * inputSize;
      for (let i = 0; i < inputSize; i++) gW1[base + i] = (gW1[base + i] ?? 0) + d * (s.x[i] ?? 0);
    }
  }

  const nB = Math.max(1, batch.length);
  const scale = lr / nB;
  const decay = 1 - lr * l2;
  for (let k = 0; k < net.w1.length; k++) net.w1[k] = (net.w1[k] ?? 0) * decay - scale * (gW1[k] ?? 0);
  for (let k = 0; k < net.b1.length; k++) net.b1[k] = (net.b1[k] ?? 0) - scale * (gb1[k] ?? 0);
  for (let k = 0; k < net.wPolicy.length; k++) {
    net.wPolicy[k] = (net.wPolicy[k] ?? 0) * decay - scale * (gWP[k] ?? 0);
  }
  for (let k = 0; k < net.bPolicy.length; k++) net.bPolicy[k] = (net.bPolicy[k] ?? 0) - scale * (gbP[k] ?? 0);
  for (let k = 0; k < net.wValue.length; k++) {
    net.wValue[k] = (net.wValue[k] ?? 0) * decay - scale * (gWV[k] ?? 0);
  }
  (net as { bValue: number }).bValue = net.bValue - scale * gbV;

  return { loss: (policyLoss + valueLoss) / nB, policyLoss: policyLoss / nB, valueLoss: valueLoss / nB };
}

// ---- Policy gradient (REINFORCE with a value baseline / tiny actor-critic) ----

export interface RlSample {
  readonly x: Float32Array;
  readonly mask: Float32Array;
  /** The flat action slot that was taken. */
  readonly actionSlot: number;
  /** Advantage A_t = return − V(s_t) (compute with the value head; normalize across the batch). */
  readonly advantage: number;
  /** Monte-Carlo return target for the value head. */
  readonly ret: number;
}

export interface RlStats {
  readonly valueLoss: number;
  readonly meanAdvantage: number;
}

/**
 * One actor-critic SGD step. MUTATES `net`. Policy gradient is advantage·(p − 1[a]);
 * the value head regresses to the return. `valueCoef` weights the value loss.
 */
export function reinforceStep(
  net: NetParams,
  batch: readonly RlSample[],
  lr: number,
  valueCoef = 0.5,
  l2 = 0,
): RlStats {
  const { inputSize, actionSize, hidden } = net.config;
  const gW1 = new Float64Array(hidden * inputSize);
  const gb1 = new Float64Array(hidden);
  const gWP = new Float64Array(actionSize * hidden);
  const gbP = new Float64Array(actionSize);
  const gWV = new Float64Array(hidden);
  let gbV = 0;
  let valueLoss = 0;
  let advSum = 0;

  for (const s of batch) {
    const hPre = new Float64Array(hidden);
    const h = new Float64Array(hidden);
    for (let j = 0; j < hidden; j++) {
      let sum = net.b1[j] ?? 0;
      const base = j * inputSize;
      for (let i = 0; i < inputSize; i++) sum += (net.w1[base + i] ?? 0) * (s.x[i] ?? 0);
      hPre[j] = sum;
      h[j] = sum > 0 ? sum : 0;
    }
    const logits = new Float64Array(actionSize);
    for (let a = 0; a < actionSize; a++) {
      let sum = net.bPolicy[a] ?? 0;
      const base = a * hidden;
      for (let j = 0; j < hidden; j++) sum += (net.wPolicy[base + j] ?? 0) * (h[j] ?? 0);
      logits[a] = sum;
    }
    const p = new Float64Array(actionSize);
    let max = -Infinity;
    for (let a = 0; a < actionSize; a++) if ((s.mask[a] ?? 0) > 0 && (logits[a] ?? 0) > max) max = logits[a] ?? 0;
    if (max > -Infinity) {
      let zs = 0;
      for (let a = 0; a < actionSize; a++)
        if ((s.mask[a] ?? 0) > 0) {
          const e = Math.exp((logits[a] ?? 0) - max);
          p[a] = e;
          zs += e;
        }
      if (zs > 0) for (let a = 0; a < actionSize; a++) p[a] = (p[a] ?? 0) / zs;
    }
    let vPre = net.bValue;
    for (let j = 0; j < hidden; j++) vPre += (net.wValue[j] ?? 0) * (h[j] ?? 0);
    const v = 1 / (1 + Math.exp(-vPre));
    valueLoss += (v - s.ret) * (v - s.ret);
    advSum += s.advantage;

    // Policy gradient on logits: A·(p − onehot(a)) over legal slots.
    const dLogit = new Float64Array(actionSize);
    for (let a = 0; a < actionSize; a++) {
      if ((s.mask[a] ?? 0) > 0) dLogit[a] = s.advantage * ((p[a] ?? 0) - (a === s.actionSlot ? 1 : 0));
    }
    const dValuePre = valueCoef * 2 * (v - s.ret) * v * (1 - v);

    const dHpre = new Float64Array(hidden);
    for (let j = 0; j < hidden; j++) {
      let g = dValuePre * (net.wValue[j] ?? 0);
      for (let a = 0; a < actionSize; a++) g += (dLogit[a] ?? 0) * (net.wPolicy[a * hidden + j] ?? 0);
      dHpre[j] = (hPre[j] ?? 0) > 0 ? g : 0;
    }
    for (let a = 0; a < actionSize; a++) {
      const d = dLogit[a] ?? 0;
      gbP[a] = (gbP[a] ?? 0) + d;
      const base = a * hidden;
      for (let j = 0; j < hidden; j++) gWP[base + j] = (gWP[base + j] ?? 0) + d * (h[j] ?? 0);
    }
    for (let j = 0; j < hidden; j++) gWV[j] = (gWV[j] ?? 0) + dValuePre * (h[j] ?? 0);
    gbV += dValuePre;
    for (let j = 0; j < hidden; j++) {
      const d = dHpre[j] ?? 0;
      gb1[j] = (gb1[j] ?? 0) + d;
      const base = j * inputSize;
      for (let i = 0; i < inputSize; i++) gW1[base + i] = (gW1[base + i] ?? 0) + d * (s.x[i] ?? 0);
    }
  }

  const nB = Math.max(1, batch.length);
  const sc = lr / nB;
  const decay = 1 - lr * l2;
  for (let k = 0; k < net.w1.length; k++) net.w1[k] = (net.w1[k] ?? 0) * decay - sc * (gW1[k] ?? 0);
  for (let k = 0; k < net.b1.length; k++) net.b1[k] = (net.b1[k] ?? 0) - sc * (gb1[k] ?? 0);
  for (let k = 0; k < net.wPolicy.length; k++) net.wPolicy[k] = (net.wPolicy[k] ?? 0) * decay - sc * (gWP[k] ?? 0);
  for (let k = 0; k < net.bPolicy.length; k++) net.bPolicy[k] = (net.bPolicy[k] ?? 0) - sc * (gbP[k] ?? 0);
  for (let k = 0; k < net.wValue.length; k++) net.wValue[k] = (net.wValue[k] ?? 0) * decay - sc * (gWV[k] ?? 0);
  (net as { bValue: number }).bValue = net.bValue - sc * gbV;

  return { valueLoss: valueLoss / nB, meanAdvantage: advSum / nB };
}
