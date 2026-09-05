import { describe, expect, it } from "bun:test";
import { G2Controller, gestureFromEventType, terminalCloseMessage } from "./controller.ts";
import { makeWhisper } from "../../../packages/shared/whisper/index.ts";

describe("G2Controller", () => {
  it("turns replacement and unpair closes into terminal instructions", () => {
    expect(terminalCloseMessage(4409)).toBe("Replaced by another device. Reopen to take over.");
    expect(terminalCloseMessage(4401)).toBe("Unpaired. Reopen the app to get a new code.");
    expect(terminalCloseMessage(1006)).toBeNull();
  });
  it("maps SDK event ordinals to the correct gestures", () => {
    // @evenrealities/even_hub_sdk@0.0.14 OsEventTypeList values.
    enum SdkEventType {
      CLICK_EVENT = 0,
      SCROLL_TOP_EVENT = 1,
      SCROLL_BOTTOM_EVENT = 2,
      DOUBLE_CLICK_EVENT = 3,
    }

    expect(gestureFromEventType(SdkEventType.CLICK_EVENT)).toBe("CLICK");
    expect(gestureFromEventType(SdkEventType.SCROLL_TOP_EVENT)).toBe("SCROLL_TOP");
    expect(gestureFromEventType(SdkEventType.SCROLL_BOTTOM_EVENT)).toBe("SCROLL_BOTTOM");
    expect(gestureFromEventType(SdkEventType.DOUBLE_CLICK_EVENT)).toBe("DOUBLE_CLICK");
  });
  it("wires queue to display and gestures to semantic cues", async () => {
    const shown: string[] = [];
    const sent: string[] = [];
    const c = new G2Controller({
      display: async (text) => void shown.push(text),
      send: (value) => sent.push(value),
      now: () => 0,
    });
    await c.whisper(makeWhisper({ text: "first" }, 0));
    await c.whisper(makeWhisper({ text: "urgent", priority: "high" }, 0));
    expect(shown.at(-1)).toBe("urgent");
    await c.gesture("CLICK");
    await c.gesture("DOUBLE_CLICK");
    await c.gesture("SCROLL_BOTTOM");
    await c.gesture("SCROLL_TOP");
    expect(sent.map((value) => JSON.parse(value)).map((value) => value.cue)).toEqual([
      "confirm",
      "dismiss",
      "next",
      "more",
    ]);
  });
});
