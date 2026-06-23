import { describe, expect, it } from 'vitest';
import { resolveClient, type ResolveProbes } from './resolve.js';
import { resolveConfig, type Config } from '../config.js';

const base = (over: Record<string, string | undefined> = {}): Config =>
  resolveConfig({ argv: [], env: { ...over }, homedir: '/h' });

const probes = (claude: boolean, ollamaModels: string[] | null): ResolveProbes => ({
  hasClaudeCli: () => Promise.resolve(claude),
  probeOllama: () => Promise.resolve(ollamaModels),
});

describe('resolveClient ladder', () => {
  it('prefers the API key over everything', async () => {
    const client = await resolveClient(base({ ANTHROPIC_API_KEY: 'k' }), probes(true, ['m']));
    expect(client?.name).toBe('anthropic');
  });

  it('falls back to the Claude Code CLI', async () => {
    const client = await resolveClient(base(), probes(true, ['m']));
    expect(client?.name).toBe('claude-cli');
  });

  it('falls back to Ollama with a probed model', async () => {
    const client = await resolveClient(base(), probes(false, ['llama3.2:1b']));
    expect(client?.name).toBe('openai-compat');
  });

  it('returns null when no rung is available', async () => {
    expect(await resolveClient(base(), probes(false, null))).toBeNull();
    expect(await resolveClient(base(), probes(false, []))).toBeNull();
  });

  it('respects explicit provider choices', async () => {
    expect(
      await resolveClient(
        base({ CCC_AI_PROVIDER: 'static', ANTHROPIC_API_KEY: 'k' }),
        probes(true, ['m']),
      ),
    ).toBeNull();
    const cli = await resolveClient(
      base({ CCC_AI_PROVIDER: 'claude-cli', ANTHROPIC_API_KEY: 'k' }),
      probes(false, null),
    );
    expect(cli?.name).toBe('claude-cli');
  });

  it('treats a bare base URL as an openai-compat request', async () => {
    const client = await resolveClient(
      base({ CCC_AI_BASE_URL: 'http://localhost:1234', CCC_AI_MODEL: 'local-x' }),
      probes(true, null),
    );
    expect(client?.name).toBe('openai-compat');
  });
});
