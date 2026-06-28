// A SEPARATE value network — its own trunk, not shared with the policy head.
//
// The shared-trunk value head collapsed to a near-constant ~50% (see docs/value-head-calibration.md):
// the hidden layer is shaped by the policy cross-entropy, and a linear value head reading those
// policy-features can't recover winnability even with honest targets, threat-aware input, or value-
// loss up-weighting. This is a standalone MLP (input → ReLU hidden → sigmoid) trained purely by value
// regression, so nothing competes for its representation. Hand-derived backprop; gradient-checked.

export interface ValueNetConfig {
  readonly inputSize: number;
  readonly hidden: number;
}

export interface ValueNetParams {
  readonly config: ValueNetConfig;
  readonly w1: number[]; // hidden * inputSize, row-major
  readonly b1: number[]; // hidden
  readonly wOut: number[]; // hidden
  bOut: number; // scalar
}

export interface ValueSample {
  readonly x: Float32Array;
  /** Target win probability in [0,1] (an honest realized outcome). */
  readonly target: number;
}

function xavier(fanIn: number, fanOut: number, rand: () => number): number {
  const limit = Math.sqrt(6 / (fanIn + fanOut));
  return (rand() * 2 - 1) * limit;
}

export function createValueNet(config: ValueNetConfig, rand: () => number): ValueNetParams {
  const { inputSize, hidden } = config;
  return {
    config,
    w1: Array.from({ length: hidden * inputSize }, () => xavier(inputSize, hidden, rand)),
    b1: new Array<number>(hidden).fill(0),
    wOut: Array.from({ length: hidden }, () => xavier(hidden, 1, rand)),
    bOut: 0,
  };
}

/** Deep copy — snapshot before further in-place training (e.g. best-epoch selection). */
export function cloneValueNet(net: ValueNetParams): ValueNetParams {
  return { config: net.config, w1: [...net.w1], b1: [...net.b1], wOut: [...net.wOut], bOut: net.bOut };
}

const sigmoid = (x: number): number => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));

/** Predict win probability in [0,1] for one observation. */
export function valueForward(net: ValueNetParams, x: Float32Array): number {
  const { inputSize, hidden } = net.config;
  let pre = net.bOut;
  for (let j = 0; j < hidden; j++) {
    let sum = net.b1[j] ?? 0;
    const base = j * inputSize;
    for (let i = 0; i < inputSize; i++) sum += (net.w1[base + i] ?? 0) * (x[i] ?? 0);
    const h = sum > 0 ? sum : 0;
    pre += (net.wOut[j] ?? 0) * h;
  }
  return sigmoid(pre);
}

/** One SGD step of MSE regression over `batch`. MUTATES `net`. `l2` decays the weight matrices. */
export function valueTrainStep(
  net: ValueNetParams,
  batch: readonly ValueSample[],
  lr: number,
  l2 = 0,
): { loss: number } {
  const { inputSize, hidden } = net.config;
  const gW1 = new Float64Array(hidden * inputSize);
  const gb1 = new Float64Array(hidden);
  const gWOut = new Float64Array(hidden);
  let gbOut = 0;
  let loss = 0;

  for (const s of batch) {
    const hPre = new Float64Array(hidden);
    const h = new Float64Array(hidden);
    let pre = net.bOut;
    for (let j = 0; j < hidden; j++) {
      let sum = net.b1[j] ?? 0;
      const base = j * inputSize;
      for (let i = 0; i < inputSize; i++) sum += (net.w1[base + i] ?? 0) * (s.x[i] ?? 0);
      hPre[j] = sum;
      h[j] = sum > 0 ? sum : 0;
      pre += (net.wOut[j] ?? 0) * (h[j] ?? 0);
    }
    const v = sigmoid(pre);
    loss += (v - s.target) * (v - s.target);
    const dPre = 2 * (v - s.target) * v * (1 - v); // d/dpre of (sigmoid(pre) − t)²
    for (let j = 0; j < hidden; j++) {
      gWOut[j] = (gWOut[j] ?? 0) + dPre * (h[j] ?? 0);
      const dhPre = (hPre[j] ?? 0) > 0 ? dPre * (net.wOut[j] ?? 0) : 0;
      gb1[j] = (gb1[j] ?? 0) + dhPre;
      const base = j * inputSize;
      for (let i = 0; i < inputSize; i++) gW1[base + i] = (gW1[base + i] ?? 0) + dhPre * (s.x[i] ?? 0);
    }
    gbOut += dPre;
  }

  const nB = Math.max(1, batch.length);
  const scale = lr / nB;
  const decay = 1 - lr * l2;
  for (let k = 0; k < net.w1.length; k++) net.w1[k] = (net.w1[k] ?? 0) * decay - scale * (gW1[k] ?? 0);
  for (let k = 0; k < net.b1.length; k++) net.b1[k] = (net.b1[k] ?? 0) - scale * (gb1[k] ?? 0);
  for (let k = 0; k < net.wOut.length; k++) net.wOut[k] = (net.wOut[k] ?? 0) * decay - scale * (gWOut[k] ?? 0);
  net.bOut = net.bOut - scale * gbOut;

  return { loss: loss / nB };
}
