export type CliShortcut = 'help' | 'version' | null;

/** Detect --help/--version style invocations before normal command dispatch. */
export function cliShortcut(argv: readonly string[]): CliShortcut {
  if (argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') return 'help';
  if (argv.includes('--version') || argv.includes('-v')) return 'version';
  return null;
}

export const USAGE = `Claude Code Crawler — a roguelike that runs beside Claude Code.

Usage: ccc <command> [options]   (also available as: crawler)

Commands:
  play                  Launch the game (default)
  init [--remove]       Install (or remove) Claude Code hooks in this project
  doctor                Diagnose hooks, event flow, and the AI backend
  simulate <scenario>   Feed synthetic events into a live game
                        scenarios: busy-refactor, review-time, quiet-session
                        (or pass a path to a recorded session .jsonl)
  hook <type>           Internal: record a hook event (invoked by Claude Code)

Options:
  --help, -h            Show this help
  --version, -v         Show version
  --seed <seed>         Fixed run seed
  --snark <0|1|2>       Announcer snark: 0 dry, 1 wry, 2 roast
  --api-key <key>       Anthropic API key (optional; falls back to Claude CLI / Ollama / static)
  --ai-provider <p>     anthropic | claude-cli | openai-compat | static
  --ai-base-url <url>   OpenAI-compatible endpoint (e.g. a local Ollama server)
  --ai-model <model>    Model name for the chosen backend
  --ai-budget <usd>     Per-run AI spend cap (default 0.05)
  --ai-transcript       Log AI prompts/responses for tuning
  --run-ttl-hours <h>   Hours before an unfinished run retires (default 24)
  --save-dir <dir>      Save location (default ~/.claude-code-crawler)

Not affiliated with, endorsed by, or sponsored by Anthropic.
Claude and Claude Code are trademarks of Anthropic.`;
