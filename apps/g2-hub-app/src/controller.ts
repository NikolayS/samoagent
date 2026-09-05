import { OsEventTypeList } from "@evenrealities/even_hub_sdk";
import {
  WhisperQueue,
  type CueSemantic,
  type Whisper,
} from "../../../packages/shared/whisper/index.ts";

/** Physical gestures understood by the G2 controller. */
export type Gesture = "CLICK" | "DOUBLE_CLICK" | "SCROLL_BOTTOM" | "SCROLL_TOP";

const cues: Record<Gesture, CueSemantic> = {
  CLICK: "confirm",
  DOUBLE_CLICK: "dismiss",
  SCROLL_BOTTOM: "next",
  SCROLL_TOP: "more",
};

export function terminalCloseMessage(code: number): string | null {
  if (code === 4409) return "Replaced by another device. Reopen to take over.";
  if (code === 4401) return "Unpaired. Reopen the app to get a new code.";
  return null;
}

/** Convert an SDK `OsEventTypeList` value into a controller gesture. */
export function gestureFromEventType(eventType: number): Gesture | null {
  switch (eventType) {
    case OsEventTypeList.CLICK_EVENT:
      return "CLICK";
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return "SCROLL_TOP";
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return "SCROLL_BOTTOM";
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return "DOUBLE_CLICK";
    default:
      return null;
  }
}

/** Normalize the text- and system-event shapes emitted by simulator and hardware. */
export function gestureFromEvent(event: {
  textEvent?: { eventType?: number };
  sysEvent?: { eventType?: number; eventSource?: number };
}): Gesture | null {
  const subEvent = event.textEvent ?? event.sysEvent;
  if (!subEvent) return null;
  return gestureFromEventType(subEvent.eventType ?? OsEventTypeList.CLICK_EVENT);
}

/**
 * Owns the wearer-visible whisper queue and gesture-to-cue protocol.
 *
 * High-priority whispers preempt through `WhisperQueue`; dismiss and next
 * consume the current item, while every gesture sends a semantic cue upstream.
 */
export class G2Controller {
  private queue: WhisperQueue;

  constructor(
    private deps: {
      display(text: string): Promise<void>;
      send(value: string): void;
      now(): number;
    },
  ) {
    this.queue = new WhisperQueue({ now: deps.now });
  }

  /** Enqueue an incoming whisper and refresh the glasses display. */
  async whisper(whisper: Whisper): Promise<void> {
    this.queue.push(whisper);
    await this.render();
  }

  /** Send a semantic cue and apply the gesture's queue action. */
  async gesture(gesture: Gesture): Promise<void> {
    this.deps.send(JSON.stringify({ type: "cue", cue: cues[gesture] }));
    if (gesture === "DOUBLE_CLICK" || gesture === "SCROLL_BOTTOM") {
      this.queue.take();
    }
    await this.render();
  }

  private async render(): Promise<void> {
    await this.deps.display(this.queue.current()?.text ?? "Paired. Listening…");
  }
}
