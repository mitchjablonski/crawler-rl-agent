#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { resolveConfig } from './config.js';
import { USAGE, cliShortcut } from './cli-args.js';

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const shortcut = cliShortcut(process.argv.slice(2));
if (shortcut === 'help') {
  console.log(USAGE);
  process.exit(0);
}
if (shortcut === 'version') {
  console.log(readVersion());
  process.exit(0);
}

const rawCommand = process.argv[2];
const command = rawCommand?.startsWith('--') ? undefined : rawCommand;
const args = process.argv.slice(command === undefined ? 2 : 3);

async function main(): Promise<void> {
  const config = resolveConfig();
  const eventsDir = path.join(config.saveDir, 'events');

  switch (command) {
    case 'hook': {
      // Hot path inside Claude Code tool calls: no Ink/React imports here.
      const { readStdin, writeHookEvent } = await import('./events/hookWriter.js');
      const raw = await readStdin();
      writeHookEvent(args[0] ?? 'Unknown', raw, { eventsDir });
      return;
    }
    case 'init': {
      const { installHooks, removeHooks } = await import('./events/install.js');
      const remove = args.includes('--remove');
      try {
        const result = remove
          ? removeHooks(process.cwd())
          : installHooks(process.cwd());
        if (remove) {
          console.log(
            result.changed
              ? `Removed crawler hooks from ${result.settingsPath}`
              : 'No crawler hooks were installed.',
          );
        } else {
          console.log(
            result.changed
              ? `Installed crawler hooks into ${result.settingsPath}`
              : 'Crawler hooks already installed.',
          );
        }
      } catch (err) {
        console.error(`init failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
      return;
    }
    case 'simulate': {
      const [{ isScenario, loadReplay, runSimulation, scenarioRecords, SCENARIOS }, fsMod] =
        await Promise.all([import('./events/simulate.js'), import('node:fs')]);
      const target = args[0];
      if (target !== undefined && isScenario(target)) {
        await runSimulation(scenarioRecords(target, Date.now()), eventsDir, console.log);
      } else if (target !== undefined && fsMod.default.existsSync(target)) {
        await runSimulation(loadReplay(target, Date.now()), eventsDir, console.log);
      } else {
        console.error(
          `Unknown scenario: ${target ?? '(none)'}\nScenarios: ${SCENARIOS.join(', ')} — or a path to a recorded session .jsonl`,
        );
        process.exitCode = 1;
      }
      return;
    }
    case 'doctor': {
      const [{ runDoctor }, { resolveClient }] = await Promise.all([
        import('./events/doctor.js'),
        import('./ai/resolve.js'),
      ]);
      const report = runDoctor(process.cwd(), eventsDir);
      for (const line of report.lines) console.log(line);
      const client = await resolveClient(config);
      console.log(
        `[ok] dungeon announcer backend: ${client?.name ?? 'static (no API key, claude CLI, or local model found)'}`,
      );
      process.exitCode = report.ok ? 0 : 1;
      return;
    }
    case 'play':
    case undefined: {
      const [{ render }, { createSaveStore }, { App }, { resolveClient }, { createDungeonAi }, fs, pathMod] =
        await Promise.all([
          import('ink'),
          import('./persistence/saves.js'),
          import('./ui/App.js'),
          import('./ai/resolve.js'),
          import('./ai/dungeonAi.js'),
          import('node:fs'),
          import('node:path'),
        ]);
      const store = createSaveStore(config.saveDir);
      const client = await resolveClient(config);
      const transcript = config.aiTranscript
        ? (entry: Readonly<Record<string, unknown>>) => {
            try {
              fs.default.appendFileSync(
                pathMod.default.join(config.saveDir, 'ai-transcript.jsonl'),
                `${JSON.stringify(entry)}\n`,
              );
            } catch {
              // Transcript is best-effort.
            }
          }
        : undefined;
      const ai = createDungeonAi({ client, budgetUsd: config.aiBudgetUsd, transcript });
      render(
        <App
          deps={{
            store,
            seed: config.seed,
            eventsDir,
            snarkLevel: config.snarkLevel,
            difficulty: config.difficulty,
            runMode: config.runMode,
            character: config.character,
            ai,
            runTtlMs: config.runTtlHours * 60 * 60 * 1000,
          }}
        />,
      );
      return;
    }
    default:
      console.error(
        `Unknown command: ${command}\nUsage: ccc [play|init [--remove]|doctor|simulate <scenario|file>|hook <type>]`,
      );
      process.exitCode = 1;
  }
}

void main();
