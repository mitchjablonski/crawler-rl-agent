import { execFile } from 'node:child_process';
import type { Config } from '../config.js';
import {
  anthropicClient,
  claudeCliClient,
  openAiCompatClient,
  type CompletionClient,
} from './clients.js';

export interface ResolveProbes {
  hasClaudeCli(): Promise<boolean>;
  /** Returns available model names, or null if no server is reachable. */
  probeOllama(baseUrl: string): Promise<string[] | null>;
}

const OLLAMA_URL = 'http://localhost:11434';

export const realProbes: ResolveProbes = {
  hasClaudeCli(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile('claude', ['--version'], { timeout: 3000, windowsHide: true }, (error) =>
        resolve(!error),
      );
    });
  },
  async probeOllama(baseUrl: string): Promise<string[] | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    try {
      const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
      if (!response.ok) return null;
      const data = (await response.json()) as { models?: { name?: string }[] };
      return (data.models ?? []).map((m) => m.name ?? '').filter((n) => n.length > 0);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  },
};

/** Walk the provider ladder: explicit config > API key > Claude CLI > Ollama > null (static). */
export async function resolveClient(
  config: Config,
  probes: ResolveProbes = realProbes,
): Promise<CompletionClient | null> {
  const baseUrl = config.aiBaseUrl ?? OLLAMA_URL;

  switch (config.aiProvider) {
    case 'static':
      return null;
    case 'anthropic':
      return config.apiKey ? anthropicClient(config.apiKey, config.aiModel) : null;
    case 'claude-cli':
      return claudeCliClient(config.aiModel ?? 'haiku');
    case 'openai-compat': {
      const model = config.aiModel ?? (await probes.probeOllama(baseUrl))?.[0];
      return model ? openAiCompatClient(baseUrl, model) : null;
    }
    case undefined:
      break;
  }

  // A base URL without a provider means: use that local server.
  if (config.aiBaseUrl) {
    const model = config.aiModel ?? (await probes.probeOllama(baseUrl))?.[0];
    return model ? openAiCompatClient(baseUrl, model) : null;
  }

  if (config.apiKey) return anthropicClient(config.apiKey, config.aiModel);
  if (await probes.hasClaudeCli()) return claudeCliClient(config.aiModel ?? 'haiku');
  const models = await probes.probeOllama(baseUrl);
  if (models && models.length > 0) {
    return openAiCompatClient(baseUrl, config.aiModel ?? (models[0] as string));
  }
  return null;
}
