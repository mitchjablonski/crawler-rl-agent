/**
 * Record the agent (hybrid PUCT) playing a full run and emit a self-contained
 * replay viewer at docs/demo.html (no server needed — trajectory embedded).
 *
 *   npx tsx scripts/demo.ts --ckpt=.models/unified.json --iters=120 --enemyhp=1.0
 */
import { writeFileSync } from 'node:fs';
import { Rng, seedFromString } from '../src/engine/rng.js';
import { applyAction, createRun, type RunConfig } from '../src/engine/run.js';
import { DEFAULT_RUN_CONFIG, content } from '../src/engine/content/index.js';
import type { ContentRegistry, GameAction, RunState } from '../src/engine/types.js';
import { createEncoder } from '../src/search/encode.js';
import { actionMask } from '../src/search/mask.js';
import type { NetParams } from '../src/search/net.js';
import { loadCheckpoint } from '../src/search/checkpoint.js';
import { greedyRollout } from '../src/search/heuristic.js';
import { puctSearch } from '../src/search/puct.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const CKPT = arg('ckpt', '.models/unified.json');
const ITERS = Number(arg('iters', '120'));
const HP = Number(arg('enemyhp', '1.0'));
const ACTS = Number(arg('acts', '1'));
const MAX_TRIES = Number(arg('tries', '12'));

const ck = loadCheckpoint(CKPT);
const enc = createEncoder(content, ck.manifest);
const net = ck.model as NetParams;

const cardName = (c: ContentRegistry, id: string): string => c.cards[id]?.name ?? id;
const statusList = (s: Record<string, number | undefined>): Array<{ k: string; v: number }> =>
  Object.entries(s).filter(([, v]) => (v ?? 0) !== 0).map(([k, v]) => ({ k, v: v as number }));

function describe(c: ContentRegistry, state: RunState, a: GameAction): string {
  switch (a.type) {
    case 'chooseNode': return `Take the ${state.map.nodes[a.nodeId]?.kind ?? '?'} path`;
    case 'playCard': {
      const id = state.combat?.hand[a.handIndex];
      const nm = id ? cardName(c, id) : 'card';
      const tgt = a.targetIndex !== undefined ? state.combat?.enemies[a.targetIndex]?.name : undefined;
      return `Play ${nm}${tgt ? ` → ${tgt}` : ''}`;
    }
    case 'endTurn': return 'End turn';
    case 'pickRewardCard': { const id = state.reward?.cards[a.index]; return `Take ${id ? cardName(c, id) : 'card'}`; }
    case 'skipReward': return 'Skip reward';
    case 'buyCard': { const id = state.shop?.stock[a.index]?.cardId; return `Buy ${id ? cardName(c, id) : 'card'}`; }
    case 'leaveShop': return 'Leave shop';
    case 'rest': return 'Rest (heal)';
    case 'chooseEventOption': {
      const ev = state.event ? c.events[state.event.eventId] : undefined;
      return `Choose: ${ev?.options[a.index]?.label ?? `option ${a.index + 1}`}`;
    }
  }
}

interface Step { [k: string]: unknown }

function snapshot(state: RunState, action: GameAction, visits: Float32Array): Step {
  const node = state.map.nodes[state.currentNodeId];
  const snap: Step = {
    phase: state.phase, act: node?.act ?? 0, row: node?.row ?? 0, nodeKind: node?.kind ?? '',
    hp: state.hp, maxHp: state.maxHp, gold: state.gold, deck: state.deck.length,
  };
  const cb = state.combat;
  if (cb) {
    snap.combat = {
      turn: cb.turn, energy: cb.energy, maxEnergy: cb.maxEnergy, block: cb.playerBlock,
      statuses: statusList(cb.playerStatuses),
      hand: cb.hand.map((id) => ({ name: cardName(content, id), cost: content.cards[id]?.cost ?? 0, type: content.cards[id]?.type ?? '' })),
      enemies: cb.enemies.map((e) => ({
        name: e.name, hp: Math.max(0, e.hp), maxHp: e.maxHp, block: e.block, dead: e.hp <= 0,
        intent: content.enemies[e.defId]?.moves[e.nextMoveIndex]?.name ?? '', statuses: statusList(e.statuses),
      })),
    };
  }
  if (state.phase === 'reward') snap.choices = (state.reward?.cards ?? []).map((id) => cardName(content, id));
  if (state.phase === 'shop') snap.choices = (state.shop?.stock ?? []).map((s) => `${cardName(content, s.cardId)} · ${s.price}g${s.sold ? ' (sold)' : ''}`);
  if (state.phase === 'event') {
    const ev = state.event ? content.events[state.event.eventId] : undefined;
    snap.eventPrompt = ev?.prompt ?? '';
    snap.choices = (ev?.options ?? []).map((o) => o.label);
  }
  if (state.phase === 'map') snap.choices = (node?.next ?? []).map((id) => state.map.nodes[id]?.kind ?? '?');
  snap.action = describe(content, state, action);
  // Mark exactly which element the agent acted on, so the viewer can highlight it.
  snap.chosenHand = action.type === 'playCard' ? action.handIndex : -1;
  snap.chosenEnemy = action.type === 'playCard' && action.targetIndex !== undefined ? action.targetIndex : -1;
  snap.chosenChoice =
    action.type === 'chooseNode'
      ? (node?.next ?? []).indexOf(action.nodeId)
      : action.type === 'pickRewardCard' || action.type === 'buyCard' || action.type === 'chooseEventOption'
        ? action.index
        : -1;
  const { actions } = actionMask(content, state);
  let total = 0;
  for (const v of visits) total += v;
  const moves: Array<{ desc: string; frac: number }> = [];
  for (let i = 0; i < visits.length; i++) {
    const v = visits[i] ?? 0;
    const act = actions[i];
    if (v > 0 && act) moves.push({ desc: describe(content, state, act), frac: total > 0 ? v / total : 0 });
  }
  moves.sort((a, b) => b.frac - a.frac);
  snap.topMoves = moves.slice(0, 3);
  return snap;
}

// Play until we get a win (nicer demo), up to MAX_TRIES seeds.
let steps: Step[] = [];
let result = 'defeat';
let usedSeed = '';
for (let t = 0; t < MAX_TRIES; t++) {
  const seed = `demo-${t}`;
  const config: RunConfig = { ...DEFAULT_RUN_CONFIG, enemyHpMult: HP, acts: ACTS };
  const rng = new Rng(seedFromString(`demo-search-${t}`));
  const rec: Step[] = [];
  let s: RunState = createRun(content, seed, config);
  for (let i = 0; i < 6000 && s.phase !== 'victory' && s.phase !== 'defeat'; i++) {
    const res = puctSearch(content, s, { encoder: enc, net, iterations: ITERS, rand: () => rng.next(), leafRollout: greedyRollout });
    rec.push(snapshot(s, res.action, res.visits));
    s = applyAction(content, s, res.action);
  }
  if (s.phase === 'victory') { steps = rec; result = 'victory'; usedSeed = seed; break; }
  if (!steps.length) { steps = rec; result = s.phase; usedSeed = seed; } // fallback: keep the last attempt
}
console.log(`recorded ${steps.length} decisions · result=${result} · seed=${usedSeed} · hp=${HP} · iters=${ITERS}`);

const TRAJ = JSON.stringify({ result, seed: usedSeed, enemyHpMult: HP, acts: ACTS, iters: ITERS, steps });

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Agent Demo — Claude Code Crawler</title>
<style>
:root{--bg:#0f1117;--panel:#171a23;--p2:#1e222e;--ink:#e7e9ee;--muted:#9aa3b2;--line:#2a2f3d;--accent:#6ea8fe;--good:#4ade80;--bad:#f87171;--gold:#fbbf24;--mono:ui-monospace,Menlo,Consolas,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:24px 16px 60px}
h1{font-size:1.35rem;margin:0 0 4px}.sub{color:var(--muted);font-size:.9rem;margin:0 0 16px}
.bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin-bottom:12px}
.chip{font:600 12px var(--mono);padding:3px 9px;border-radius:999px;background:#6ea8fe18;color:var(--accent);border:1px solid #6ea8fe33}
.hpwrap{flex:1;min-width:140px}.hpbar{height:9px;border-radius:5px;background:var(--p2);overflow:hidden}.hpbar>span{display:block;height:100%;background:linear-gradient(90deg,#4ade80,#22c55e)}
.hpbar.enemy>span{background:linear-gradient(90deg,#f87171,#ef4444)}
.gold{color:var(--gold);font-weight:600}.muted{color:var(--muted)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:12px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.card{background:var(--p2);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:.85rem}
.card .cost{display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:50%;background:#6ea8fe22;color:var(--accent);font:600 11px var(--mono);margin-right:6px}
.enemy{background:var(--p2);border:1px solid var(--line);border-radius:8px;padding:10px;min-width:170px;flex:1}
.enemy.dead{opacity:.4;text-decoration:line-through}
.chosen{border-color:var(--accent)!important;box-shadow:0 0 0 1px var(--accent),0 0 16px #6ea8fe77;position:relative}
.chosen::after{content:'▸ TAKEN';position:absolute;top:-9px;right:8px;font:700 9px var(--mono);color:#0f1117;background:var(--accent);padding:1px 6px;border-radius:5px;white-space:nowrap}
.intent{color:var(--bad);font-size:.8rem;font-weight:600;margin-top:4px}
.st{font:600 10px var(--mono);color:var(--gold);background:#fbbf2418;border-radius:5px;padding:1px 6px;margin-left:5px}
.pips{display:inline-flex;gap:3px}.pip{width:9px;height:9px;border-radius:50%;background:#6ea8fe}.pip.off{background:var(--line)}
.decision{background:linear-gradient(180deg,#6ea8fe14,transparent);border:1px solid #6ea8fe44}
.act{font-size:1.05rem;font-weight:700;color:var(--accent)}
.alt{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:.82rem;color:var(--muted)}
.alt .ab{flex:1;height:6px;border-radius:4px;background:var(--p2);overflow:hidden}.alt .ab>span{display:block;height:100%;background:#6ea8fe66}
.ctrl{display:flex;align-items:center;gap:10px;margin-top:10px}
button{background:var(--p2);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px 14px;font-size:.95rem;cursor:pointer}
button:hover{border-color:var(--accent)}
input[type=range]{flex:1;accent-color:var(--accent)}
.result{font-weight:800}.win{color:var(--good)}.lose{color:var(--bad)}
h3{margin:0 0 8px;font-size:.95rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
</style></head><body><div class="wrap">
<h1>Agent playing Claude Code Crawler</h1>
<p class="sub">A net-guided hybrid-PUCT agent. Press play to watch it reason through a run — the move it chose, and the alternatives it weighed.</p>
<div class="bar">
  <span class="chip" id="phase"></span>
  <span class="muted" id="pos"></span>
  <div class="hpwrap"><div class="muted" style="font-size:.75rem" id="hplabel"></div><div class="hpbar"><span id="hp"></span></div></div>
  <span class="gold" id="gold"></span>
  <span class="muted" id="stepc" style="margin-left:auto;font-family:var(--mono)"></span>
</div>
<div id="board"></div>
<div class="panel decision">
  <h3>Agent decision</h3>
  <div class="act" id="act"></div>
  <div id="alts"></div>
</div>
<div class="ctrl">
  <button id="prev">⏮</button><button id="play">▶ Play</button><button id="next">⏭</button>
  <input type="range" id="slider" min="0" value="0"/>
</div>
<p class="sub" id="resline" style="margin-top:14px"></p>
</div>
<script>
const T = ${TRAJ};
const $=id=>document.getElementById(id);
$('slider').max=T.steps.length-1;
let i=0,playing=false,timer=null;
const pct=(a,b)=>b>0?Math.max(0,Math.min(100,a/b*100)):0;
function statusChips(arr){return (arr||[]).map(s=>'<span class="st">'+s.k+' '+s.v+'</span>').join('');}
function render(){
  const s=T.steps[i];
  $('phase').textContent=(s.nodeKind||s.phase).toUpperCase();
  $('pos').textContent='Act '+(s.act+1)+' · Row '+s.row;
  $('hplabel').textContent='HP '+s.hp+' / '+s.maxHp;
  $('hp').style.width=pct(s.hp,s.maxHp)+'%';
  $('gold').textContent=s.gold+'g';
  $('stepc').textContent=(i+1)+' / '+T.steps.length;
  let html='';
  if(s.combat){
    const c=s.combat;
    let pips='';for(let k=0;k<c.maxEnergy;k++)pips+='<span class="pip'+(k<c.energy?'':' off')+'"></span>';
    html+='<div class="panel"><h3>Combat · turn '+c.turn+'</h3>';
    html+='<div class="row" style="margin-bottom:10px">You <span class="pips">'+pips+'</span>'+
      (c.block>0?'<span class="chip">🛡 '+c.block+'</span>':'')+statusChips(c.statuses)+'</div>';
    html+='<div class="row" style="margin-bottom:12px">'+c.enemies.map((e,ei)=>
      '<div class="enemy'+(e.dead?' dead':'')+(ei===s.chosenEnemy?' chosen':'')+'"><b>'+e.name+'</b>'+statusChips(e.statuses)+
      '<div class="hpbar enemy" style="margin:6px 0"><span style="width:'+pct(e.hp,e.maxHp)+'%"></span></div>'+
      '<span class="muted" style="font-size:.78rem">'+e.hp+'/'+e.maxHp+(e.block>0?' · 🛡'+e.block:'')+'</span>'+
      (e.intent&&!e.dead?'<div class="intent">⚔ '+e.intent+'</div>':'')+'</div>').join('')+'</div>';
    html+='<h3>Hand</h3><div class="row">'+c.hand.map((h,hi)=>
      '<div class="card'+(hi===s.chosenHand?' chosen':'')+'"><span class="cost">'+h.cost+'</span>'+h.name+'</div>').join('')+'</div></div>';
  } else if(s.choices){
    const label={map:'Choose a path',reward:'Card reward',shop:'Shop',event:'Event',rest:'Rest site'}[s.phase]||s.phase;
    html+='<div class="panel"><h3>'+label+'</h3>';
    if(s.eventPrompt)html+='<p class="muted" style="margin-top:0">'+s.eventPrompt+'</p>';
    html+='<div class="row">'+s.choices.map((x,ci)=>'<div class="card'+(ci===s.chosenChoice?' chosen':'')+'">'+x+'</div>').join('')+'</div></div>';
  }
  $('board').innerHTML=html;
  $('act').textContent='▸ '+s.action;
  $('alts').innerHTML=(s.topMoves||[]).map(m=>
    '<div class="alt"><span style="min-width:46px;font-family:var(--mono)">'+Math.round(m.frac*100)+'%</span>'+
    '<div class="ab"><span style="width:'+Math.round(m.frac*100)+'%"></span></div>'+
    '<span style="min-width:200px">'+m.desc+'</span></div>').join('');
  $('slider').value=i;
  $('resline').innerHTML=i===T.steps.length-1?
    'Run finished — <span class="result '+(T.result==='victory'?'win">VICTORY ✦':'lose">DEFEAT')+'</span>':'';
}
function go(n){i=Math.max(0,Math.min(T.steps.length-1,n));render();}
$('prev').onclick=()=>go(i-1);$('next').onclick=()=>go(i+1);
$('slider').oninput=e=>go(+e.target.value);
$('play').onclick=()=>{playing=!playing;$('play').textContent=playing?'⏸ Pause':'▶ Play';
  if(playing){timer=setInterval(()=>{if(i>=T.steps.length-1){playing=false;$('play').textContent='▶ Play';clearInterval(timer);}else go(i+1);},650);}
  else clearInterval(timer);};
render();
</script></body></html>`;

writeFileSync('docs/demo.html', html);
console.log('wrote docs/demo.html');
