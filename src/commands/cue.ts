import { ExitError } from "../config.ts";
import { transcriptFileFromState } from "../state.ts";
import { appendTranscriptLine } from "../transcript.ts";
import type { ParsedArgs } from "../args.ts";
import { CUE_SEMANTICS, formatCueTranscriptLine, normalizeCueSemantic } from "../whisper.ts";

export interface CueDeps {
  now?: () => Date;
  appendLine?: (path: string, line: string) => void;
}

/**
 * Record the wearer's reply to a whisper.
 *
 * The cue rides the EXISTING transcript stream as a `SAMOGRAPH-CUE:` control
 * line, so an agent already running `samograph watch` receives the wearer's
 * back-channel with no second channel to wire up. The vocabulary is semantic
 * (confirm / dismiss / next / more) rather than physical, so a different input
 * device is a driver swap and nothing above it moves.
 */
export async function cmdCue(args: ParsedArgs, deps: CueDeps = {}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const appendLine = deps.appendLine ?? appendTranscriptLine;

  const semantic = normalizeCueSemantic(args.cue);
  if (semantic === null) {
    process.stderr.write(`Error: cue must be one of: ${CUE_SEMANTICS.join(", ")}\n`);
    throw new ExitError(1);
  }

  const transcriptPath = transcriptFileFromState();
  appendLine(transcriptPath, formatCueTranscriptLine(semantic, now()));
  process.stdout.write(`Cue: ${semantic}\n`);
}
