// Learned entity net: per-token embeddings (type + id + feature projection), a
// single-query ATTENTION POOLING over the tokens, then an MLP head to policy +
// value. Forward and hand-derived backprop, all in Node so it trains and runs
// here. Single-query attention (not full N×N self-attention) keeps the backward
// pass tractable to derive and gradient-check, while still being genuine attention.
//
// Consumes the entity tokens from entityEncode.ts. Value head is sigmoid → [0,1]
// to match the engine. Params are plain number[] so the net JSON-serializes.
import type { Token } from './entityEncode.js';

export interface EntityNetConfig {
  readonly numTokenTypes: number;
  /** Size of the id vocabulary (card+enemy share one table); index 0 is the null id. */
  readonly idVocab: number;
  readonly featDim: number;
  readonly actionSize: number;
  readonly dModel: number;
  readonly hidden: number;
}

export interface EntityNetParams {
  readonly config: EntityNetConfig;
  typeEmb: number[]; // numTokenTypes * dModel
  idEmb: number[]; // (idVocab + 1) * dModel  (row 0 = null id)
  wFeat: number[]; // dModel * featDim
  bFeat: number[]; // dModel
  query: number[]; // dModel
  wV: number[]; // dModel * dModel
  wH: number[]; // hidden * dModel
  bH: number[]; // hidden
  wPolicy: number[]; // actionSize * hidden
  bPolicy: number[]; // actionSize
  wValue: number[]; // hidden
  bValue: number;
}

export interface EntityOutput {
  readonly policy: Float32Array;
  readonly value: number;
}

function xavier(fanIn: number, fanOut: number, rand: () => number): number {
  return (rand() * 2 - 1) * Math.sqrt(6 / (fanIn + fanOut));
}

export function createEntityNet(config: EntityNetConfig, rand: () => number): EntityNetParams {
  const { numTokenTypes, idVocab, featDim, actionSize, dModel, hidden } = config;
  const arr = (n: number, fi: number, fo: number): number[] =>
    Array.from({ length: n }, () => xavier(fi, fo, rand));
  return {
    config,
    typeEmb: arr(numTokenTypes * dModel, numTokenTypes, dModel),
    idEmb: arr((idVocab + 1) * dModel, idVocab, dModel),
    wFeat: arr(dModel * featDim, featDim, dModel),
    bFeat: new Array<number>(dModel).fill(0),
    query: arr(dModel, dModel, 1),
    wV: arr(dModel * dModel, dModel, dModel),
    wH: arr(hidden * dModel, dModel, hidden),
    bH: new Array<number>(hidden).fill(0),
    wPolicy: arr(actionSize * hidden, hidden, actionSize),
    bPolicy: new Array<number>(actionSize).fill(0),
    wValue: arr(hidden, hidden, 1),
    bValue: 0,
  };
}

const relu = (x: number): number => (x > 0 ? x : 0);
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

interface Forward {
  readonly logits: Float64Array;
  readonly value: number;
  // cache for backward
  readonly emb: Float64Array[]; // per token, dModel
  readonly a: Float64Array; // attention weights, N
  readonly vproj: Float64Array[]; // per token wV·emb, dModel
  readonly pooled: Float64Array; // dModel
  readonly hPre: Float64Array; // hidden
  readonly h: Float64Array; // hidden
}

function forward(net: EntityNetParams, tokens: readonly Token[]): Forward {
  const { idVocab, featDim, actionSize, dModel, hidden } = net.config;
  const N = Math.max(1, tokens.length);
  const scale = 1 / Math.sqrt(dModel);

  const emb: Float64Array[] = [];
  const scores = new Float64Array(N);
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i] as Token;
    const e = new Float64Array(dModel);
    const tBase = tk.type * dModel;
    const idRow = (tk.id >= 0 && tk.id < idVocab ? tk.id + 1 : 0) * dModel;
    for (let d = 0; d < dModel; d++) {
      let s = (net.typeEmb[tBase + d] ?? 0) + (net.idEmb[idRow + d] ?? 0) + (net.bFeat[d] ?? 0);
      const wBase = d * featDim;
      for (let f = 0; f < featDim; f++) s += (net.wFeat[wBase + f] ?? 0) * (tk.feats[f] ?? 0);
      e[d] = s;
    }
    emb.push(e);
    let sc = 0;
    for (let d = 0; d < dModel; d++) sc += (net.query[d] ?? 0) * (e[d] ?? 0);
    scores[i] = sc * scale;
  }

  // softmax attention over the real tokens
  const a = new Float64Array(N);
  let max = -Infinity;
  for (let i = 0; i < tokens.length; i++) if ((scores[i] ?? 0) > max) max = scores[i] ?? 0;
  let sum = 0;
  for (let i = 0; i < tokens.length; i++) {
    const ex = Math.exp((scores[i] ?? 0) - max);
    a[i] = ex;
    sum += ex;
  }
  if (sum > 0) for (let i = 0; i < tokens.length; i++) a[i] = (a[i] ?? 0) / sum;

  // value projection + weighted pool
  const vproj: Float64Array[] = [];
  const pooled = new Float64Array(dModel);
  for (let i = 0; i < tokens.length; i++) {
    const e = emb[i] as Float64Array;
    const vp = new Float64Array(dModel);
    for (let d = 0; d < dModel; d++) {
      let s = 0;
      const wBase = d * dModel;
      for (let k = 0; k < dModel; k++) s += (net.wV[wBase + k] ?? 0) * (e[k] ?? 0);
      vp[d] = s;
      pooled[d] = (pooled[d] ?? 0) + (a[i] ?? 0) * s;
    }
    vproj.push(vp);
  }

  // MLP head
  const hPre = new Float64Array(hidden);
  const h = new Float64Array(hidden);
  for (let j = 0; j < hidden; j++) {
    let s = net.bH[j] ?? 0;
    const wBase = j * dModel;
    for (let d = 0; d < dModel; d++) s += (net.wH[wBase + d] ?? 0) * (pooled[d] ?? 0);
    hPre[j] = s;
    h[j] = relu(s);
  }
  const logits = new Float64Array(actionSize);
  for (let p = 0; p < actionSize; p++) {
    let s = net.bPolicy[p] ?? 0;
    const wBase = p * hidden;
    for (let j = 0; j < hidden; j++) s += (net.wPolicy[wBase + j] ?? 0) * (h[j] ?? 0);
    logits[p] = s;
  }
  let vPre = net.bValue;
  for (let j = 0; j < hidden; j++) vPre += (net.wValue[j] ?? 0) * (h[j] ?? 0);

  return { logits, value: sigmoid(vPre), emb, a, vproj, pooled, hPre, h };
}

/** Inference: masked-softmax-ready logits + value. */
export function predictEntity(net: EntityNetParams, tokens: readonly Token[]): EntityOutput {
  const fwd = forward(net, tokens);
  return { policy: Float32Array.from(fwd.logits), value: fwd.value };
}

export interface EntitySample {
  readonly tokens: readonly Token[];
  readonly pi: Float32Array; // target policy over slots (illegal 0, sums to 1)
  readonly mask: Float32Array;
  readonly z: number; // value target [0,1]
}

export interface EntityTrainStats {
  readonly loss: number;
  readonly policyLoss: number;
  readonly valueLoss: number;
}

/** One SGD step over a batch. MUTATES net. Loss = masked policy CE + value MSE. */
export function trainStepEntity(
  net: EntityNetParams,
  batch: readonly EntitySample[],
  lr: number,
  l2 = 0,
): EntityTrainStats {
  const { featDim, actionSize, dModel, hidden } = net.config;
  const g = {
    typeEmb: new Float64Array(net.typeEmb.length),
    idEmb: new Float64Array(net.idEmb.length),
    wFeat: new Float64Array(net.wFeat.length),
    bFeat: new Float64Array(net.bFeat.length),
    query: new Float64Array(net.query.length),
    wV: new Float64Array(net.wV.length),
    wH: new Float64Array(net.wH.length),
    bH: new Float64Array(net.bH.length),
    wPolicy: new Float64Array(net.wPolicy.length),
    bPolicy: new Float64Array(net.bPolicy.length),
    wValue: new Float64Array(net.wValue.length),
  };
  let gbValue = 0;
  let policyLoss = 0;
  let valueLoss = 0;

  for (const s of batch) {
    const fwd = forward(net, s.tokens);
    const { logits, value, emb, a, vproj, pooled, hPre, h } = fwd;
    const N = s.tokens.length;

    // masked softmax of logits
    const p = new Float64Array(actionSize);
    let max = -Infinity;
    for (let i = 0; i < actionSize; i++)
      if ((s.mask[i] ?? 0) > 0 && (logits[i] ?? 0) > max) max = logits[i] ?? 0;
    if (max > -Infinity) {
      let zs = 0;
      for (let i = 0; i < actionSize; i++)
        if ((s.mask[i] ?? 0) > 0) {
          const e = Math.exp((logits[i] ?? 0) - max);
          p[i] = e;
          zs += e;
        }
      if (zs > 0) for (let i = 0; i < actionSize; i++) p[i] = (p[i] ?? 0) / zs;
    }
    for (let i = 0; i < actionSize; i++) {
      const t = s.pi[i] ?? 0;
      if (t > 0) policyLoss += -t * Math.log((p[i] ?? 0) || 1e-12);
    }
    valueLoss += (value - s.z) * (value - s.z);

    // head grads
    const dValuePre = 2 * (value - s.z) * value * (1 - value);
    const dLogit = new Float64Array(actionSize);
    for (let i = 0; i < actionSize; i++) dLogit[i] = (s.mask[i] ?? 0) > 0 ? (p[i] ?? 0) - (s.pi[i] ?? 0) : 0;

    const dHpre = new Float64Array(hidden);
    for (let j = 0; j < hidden; j++) {
      let dh = dValuePre * (net.wValue[j] ?? 0);
      for (let pix = 0; pix < actionSize; pix++) dh += (dLogit[pix] ?? 0) * (net.wPolicy[pix * hidden + j] ?? 0);
      dHpre[j] = (hPre[j] ?? 0) > 0 ? dh : 0;
    }
    for (let pix = 0; pix < actionSize; pix++) {
      g.bPolicy[pix] = (g.bPolicy[pix] ?? 0) + (dLogit[pix] ?? 0);
      const wBase = pix * hidden;
      for (let j = 0; j < hidden; j++)
        g.wPolicy[wBase + j] = (g.wPolicy[wBase + j] ?? 0) + (dLogit[pix] ?? 0) * (h[j] ?? 0);
    }
    for (let j = 0; j < hidden; j++) g.wValue[j] = (g.wValue[j] ?? 0) + dValuePre * (h[j] ?? 0);
    gbValue += dValuePre;
    for (let j = 0; j < hidden; j++) g.bH[j] = (g.bH[j] ?? 0) + (dHpre[j] ?? 0);

    // dPooled from wH
    const dPooled = new Float64Array(dModel);
    for (let j = 0; j < hidden; j++) {
      const dhj = dHpre[j] ?? 0;
      const wBase = j * dModel;
      for (let d = 0; d < dModel; d++) {
        g.wH[wBase + d] = (g.wH[wBase + d] ?? 0) + dhj * (pooled[d] ?? 0);
        dPooled[d] = (dPooled[d] ?? 0) + dhj * (net.wH[wBase + d] ?? 0);
      }
    }

    // pooled = Σ a_i vproj_i  →  da_i and dvproj_i
    const dA = new Float64Array(N);
    const dEmb: Float64Array[] = [];
    for (let i = 0; i < N; i++) dEmb.push(new Float64Array(dModel));
    for (let i = 0; i < N; i++) {
      const vp = vproj[i] as Float64Array;
      let dai = 0;
      for (let d = 0; d < dModel; d++) dai += (dPooled[d] ?? 0) * (vp[d] ?? 0);
      dA[i] = dai;
      // dvproj_i = a_i * dPooled ; wV grads + back to emb
      const ai = a[i] ?? 0;
      const e = emb[i] as Float64Array;
      const de = dEmb[i] as Float64Array;
      for (let d = 0; d < dModel; d++) {
        const dvp = ai * (dPooled[d] ?? 0);
        const wBase = d * dModel;
        for (let k = 0; k < dModel; k++) {
          g.wV[wBase + k] = (g.wV[wBase + k] ?? 0) + dvp * (e[k] ?? 0);
          de[k] = (de[k] ?? 0) + dvp * (net.wV[wBase + k] ?? 0);
        }
      }
    }

    // softmax backward: dScore_j = a_j (dA_j - Σ_i dA_i a_i)
    let dot = 0;
    for (let i = 0; i < N; i++) dot += (dA[i] ?? 0) * (a[i] ?? 0);
    const scale = 1 / Math.sqrt(dModel);
    for (let i = 0; i < N; i++) {
      const dScore = (a[i] ?? 0) * ((dA[i] ?? 0) - dot);
      // score_i = scale * query·emb_i
      const e = emb[i] as Float64Array;
      const de = dEmb[i] as Float64Array;
      for (let d = 0; d < dModel; d++) {
        g.query[d] = (g.query[d] ?? 0) + dScore * scale * (e[d] ?? 0);
        de[d] = (de[d] ?? 0) + dScore * scale * (net.query[d] ?? 0);
      }
    }

    // emb_i = typeEmb[type] + idEmb[id+1] + wFeat·feats + bFeat
    for (let i = 0; i < N; i++) {
      const tk = s.tokens[i] as Token;
      const de = dEmb[i] as Float64Array;
      const tBase = tk.type * dModel;
      const idRow = (tk.id >= 0 && tk.id < net.config.idVocab ? tk.id + 1 : 0) * dModel;
      for (let d = 0; d < dModel; d++) {
        const ded = de[d] ?? 0;
        g.typeEmb[tBase + d] = (g.typeEmb[tBase + d] ?? 0) + ded;
        g.idEmb[idRow + d] = (g.idEmb[idRow + d] ?? 0) + ded;
        g.bFeat[d] = (g.bFeat[d] ?? 0) + ded;
        const wBase = d * featDim;
        for (let f = 0; f < featDim; f++)
          g.wFeat[wBase + f] = (g.wFeat[wBase + f] ?? 0) + ded * (tk.feats[f] ?? 0);
      }
    }
  }

  const nB = Math.max(1, batch.length);
  const sc = lr / nB;
  const decay = 1 - lr * l2;
  const applyW = (w: number[], grad: Float64Array): void => {
    for (let k = 0; k < w.length; k++) w[k] = (w[k] ?? 0) * decay - sc * (grad[k] ?? 0);
  };
  const applyB = (b: number[], grad: Float64Array): void => {
    for (let k = 0; k < b.length; k++) b[k] = (b[k] ?? 0) - sc * (grad[k] ?? 0);
  };
  applyW(net.typeEmb, g.typeEmb);
  applyW(net.idEmb, g.idEmb);
  applyW(net.wFeat, g.wFeat);
  applyB(net.bFeat, g.bFeat);
  applyW(net.query, g.query);
  applyW(net.wV, g.wV);
  applyW(net.wH, g.wH);
  applyB(net.bH, g.bH);
  applyW(net.wPolicy, g.wPolicy);
  applyB(net.bPolicy, g.bPolicy);
  applyW(net.wValue, g.wValue);
  net.bValue -= sc * gbValue;

  return { loss: (policyLoss + valueLoss) / nB, policyLoss: policyLoss / nB, valueLoss: valueLoss / nB };
}
