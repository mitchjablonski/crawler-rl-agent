import { execFile } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';

export interface Completion {
  readonly text: string;
  readonly costUsd: number;
}

export interface CompletionClient {
  readonly name: string;
  readonly timeoutMs: number;
  complete(prompt: string): Promise<Completion>;
}

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
// Haiku 4.5 pricing per million tokens.
const HAIKU_INPUT_USD = 1 / 1_000_000;
const HAIKU_OUTPUT_USD = 5 / 1_000_000;

export function anthropicClient(apiKey: string, model = HAIKU_MODEL): CompletionClient {
  const client = new Anthropic({ apiKey });
  return {
    name: 'anthropic',
    timeoutMs: 3000,
    async complete(prompt: string): Promise<Completion> {
      const response = await client.messages.create({
        model,
        max_tokens: 60,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');
      const costUsd =
        response.usage.input_tokens * HAIKU_INPUT_USD +
        response.usage.output_tokens * HAIKU_OUTPUT_USD;
      return { text, costUsd };
    },
  };
}

/** Headless Claude Code on the player's existing login. Zero marginal cost. */
export function claudeCliClient(model = 'haiku'): CompletionClient {
  return {
    name: 'claude-cli',
    timeoutMs: 10_000,
    complete(prompt: string): Promise<Completion> {
      return new Promise((resolve, reject) => {
        execFile(
          'claude',
          ['-p', prompt, '--model', model],
          { timeout: 9_500, windowsHide: true, maxBuffer: 64 * 1024 },
          (error, stdout) => {
            if (error) reject(error);
            else resolve({ text: stdout, costUsd: 0 });
          },
        );
      });
    },
  };
}

/** Ollama / LM Studio / llama.cpp / vLLM via the OpenAI-compatible chat API. */
export function openAiCompatClient(baseUrl: string, model: string): CompletionClient {
  const root = baseUrl.replace(/\/+$/, '');
  const url = root.endsWith('/v1') ? `${root}/chat/completions` : `${root}/v1/chat/completions`;
  return {
    name: 'openai-compat',
    timeoutMs: 6000,
    async complete(prompt: string): Promise<Completion> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5500);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            max_tokens: 60,
            messages: [{ role: 'user', content: prompt }],
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`${response.status}`);
        const data = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        return { text: data.choices?.[0]?.message?.content ?? '', costUsd: 0 };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
