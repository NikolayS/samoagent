import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { stateFile, ExitError } from "./config.ts";

export type State = Record<string, unknown>;

export function loadState(): State {
  const f = stateFile();
  if (existsSync(f)) {
    return JSON.parse(readFileSync(f, "utf-8")) as State;
  }
  return {};
}

export function saveState(state: State): void {
  const f = stateFile();
  const dir = dirname(f);
  const dirExisted = existsSync(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!dirExisted || process.env.SAMOGRAPH_STATE_FILE === undefined) {
    chmodSync(dir, 0o700);
  }
  writeFileSync(f, JSON.stringify(state, null, 2), { mode: 0o600 });
  chmodSync(f, 0o600);
}

export function botIdFromArgsOrState(argBotId?: string | null): string {
  if (argBotId) {
    return argBotId;
  }
  const state = loadState();
  const bid = state.bot_id;
  if (!bid || typeof bid !== "string") {
    process.stderr.write(
      "Error: no active bot. Pass BOT_ID or run 'samograph join' first.\n",
    );
    throw new ExitError(1);
  }
  return bid;
}

/**
 * Path of the ACTIVE session's transcript file, or a clean exit when there is
 * none. Unlike the read-only transcript helpers this deliberately does not fall
 * back to the default path: a surface that WRITES a control line (whisper, cue)
 * must not append to a stale file from a finished call. Mirrors
 * {@link botIdFromArgsOrState}: one stderr line, then ExitError(1).
 */
export function transcriptFileFromState(): string {
  const state = loadState();
  const tf = state.transcript_file;
  if (!tf || typeof tf !== "string") {
    process.stderr.write(
      "Error: no active session. Run 'samograph join' first.\n",
    );
    throw new ExitError(1);
  }
  return tf;
}
