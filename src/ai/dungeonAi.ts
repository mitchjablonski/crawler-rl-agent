import type { GameEvent } from '../events/types.js';
import type { SnarkLevel } from '../config.js';
import type { CompletionClient } from './clients.js';

export interface RunSummary {
  readonly hp: number;
  readonly maxHp: number;
  readonly gold: number;
  readonly depth: number;
}

export interface NarrationContext {
  readonly event: GameEvent;
  /** The static line already shown; the AI may only re-word it. */
  readonly staticLine: string;
  readonly snark: SnarkLevel;
  readonly run: RunSummary | null;
}

export interface ChristenContext {
  readonly kind: 'enemy' | 'relic' | 'boss';
  readonly baseName: string;
  readonly event?: GameEvent;
  readonly snark: SnarkLevel;
  readonly run: RunSummary | null;
}

export interface DungeonAi {
  readonly backend: string;
  narrate(ctx: NarrationContext, onLine: (line: string) => void): void;
  christen(ctx: ChristenContext, onName: (name: string) => void): void;
  spentUsd(): number;
}

export interface DungeonAiOptions {
  readonly client: CompletionClient | null;
  readonly budgetUsd: number;
  readonly transcript?: (entry: Readonly<Record<string, unknown>>) => void;
}

const MAX_LINE = 90;
const MAX_NAME = 60;

const TIER_VOICE: Readonly<Record<SnarkLevel, string>> = {
  0: 'dry, minimal, matter-of-fact',
  1: 'wry and lightly sarcastic',
  2: 'a merciless, theatrical roast of the developer',
};

export function createDungeonAi(options: DungeonAiOptions): DungeonAi {
  const { client } = options;
  let spent = 0;
  let exhausted = false;

  return {
    backend: client?.name ?? 'static',
    spentUsd: () => spent,

    narrate(ctx: NarrationContext, onLine: (line: string) => void): void {
      fire(buildPrompt(ctx), 'narration', MAX_LINE, onLine);
    },

    christen(ctx: ChristenContext, onName: (name: string) => void): void {
      fire(buildChristenPrompt(ctx), 'christening', MAX_NAME, onName);
    },
  };

  /** Fire-and-forget completion: nothing in the game ever awaits this. */
  function fire(
    prompt: string,
    label: string,
    maxLength: number,
    onText: (text: string) => void,
  ): void {
    if (!client || exhausted) return;
    if (spent >= options.budgetUsd) {
      exhausted = true;
      options.transcript?.({ kind: 'budget-exhausted', spentUsd: spent });
      return;
    }
    void Promise.race([
      client.complete(prompt),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), client.timeoutMs);
        timer.unref();
      }),
    ])
      .then((completion) => {
        spent += completion.costUsd;
        const text = extractLine(completion.text, maxLength);
        options.transcript?.({ kind: label, prompt, raw: completion.text, text });
        if (text) onText(text);
      })
      .catch((error: unknown) => {
        options.transcript?.({ kind: 'error', prompt, error: String(error) });
        // Silent: the authored text is already on screen.
      });
  }
}

function buildPrompt(ctx: NarrationContext): string {
  const detail = ctx.event.detail ? ` (${ctx.event.detail})` : '';
  return [
    'You are the Dungeon AI, the announcer of a fantasy dungeon crawl that runs beside a real coding session.',
    `Voice: ${TIER_VOICE[ctx.snark]}. Dark humor welcome; playful, never genuinely cruel.`,
    `A real coding event just happened: ${ctx.event.kind}${detail}.`,
    `Game effect already applied: ${ctx.staticLine}`,
    ctx.run
      ? `Player: ${ctx.run.hp}/${ctx.run.maxHp} HP, ${ctx.run.gold} gold, depth ${ctx.run.depth}.`
      : '',
    `Write ONE narration line for this event, under ${MAX_LINE} characters, mentioning the real event naturally. Output only the line. No quotes, no preamble.`,
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}

function buildChristenPrompt(ctx: ChristenContext): string {
  const cause = ctx.event
    ? `It was summoned by a real coding event: ${ctx.event.kind}${ctx.event.detail ? ` (${ctx.event.detail})` : ''}.`
    : '';
  return [
    'You are the Dungeon AI of a fantasy dungeon crawl running beside a real coding session.',
    `Voice: ${TIER_VOICE[ctx.snark]}. Darkly funny, never genuinely cruel.`,
    `A ${ctx.kind} appears. Its base name is "${ctx.baseName}".`,
    cause,
    ctx.run ? `Player: ${ctx.run.hp}/${ctx.run.maxHp} HP, depth ${ctx.run.depth}.` : '',
    `Invent ONE name or epithet for it (under ${MAX_NAME} characters), themed to that real work when possible. Output only the name. No quotes.`,
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}

function extractLine(raw: string, max = MAX_LINE): string | null {
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  const unquoted = line.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (unquoted.length === 0) return null;
  return unquoted.length <= max ? unquoted : `${unquoted.slice(0, max - 3)}...`;
}
