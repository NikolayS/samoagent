import {
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import { G2Controller, gestureFromEventType, terminalCloseMessage } from "./controller.ts";

const DEVICE_TOKEN_KEY = "samograph_device_token";
const relay = (import.meta.env.VITE_SAMOGRAPH_G2_RELAY ?? "https://samograph.samo.team")
  .replace(/^http/, "ws")
  .replace(/\/$/, "");
const status = (globalThis as any).document.querySelector("#status") as
  | { textContent: string | null }
  | null;
const bridge = await waitForEvenAppBridge();
const container = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  paddingLength: 8,
  containerID: 1,
  containerName: "samograph",
  content: "samograph\nConnecting…",
  isEventCapture: 1,
});

await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [container],
  }),
);

let socket: WebSocket | null = null;
let retryMs = 1_000;
let resumedWithStoredToken = false;

async function display(content: string): Promise<void> {
  if (status) status.textContent = content;
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: 1,
      containerName: "samograph",
      content,
      contentOffset: 0,
      contentLength: 0,
    }),
  );
}

const controller = new G2Controller({
  now: Date.now,
  display,
  send: (value) => socket?.send(value),
});

async function connect(): Promise<void> {
  socket = new WebSocket(`${relay}/g2/ws`);
  socket.onopen = async () => {
    retryMs = 1_000;
    const deviceToken = await bridge.getLocalStorage(DEVICE_TOKEN_KEY);
    resumedWithStoredToken = deviceToken.length > 0;
    if (deviceToken) {
      socket?.send(JSON.stringify({ type: "resume", device_token: deviceToken }));
    }
  };
  socket.onmessage = async (event: MessageEvent) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "code") {
      if (resumedWithStoredToken) {
        await bridge.setLocalStorage(DEVICE_TOKEN_KEY, "");
        resumedWithStoredToken = false;
      }
      await display(`samograph\nPair code ${message.code}`);
    }
    if (message.type === "paired") {
      await bridge.setLocalStorage(DEVICE_TOKEN_KEY, message.device_token);
      resumedWithStoredToken = false;
      await display("Paired. Listening…");
    }
    if (message.type === "whisper") {
      await controller.whisper({
        text: message.text,
        priority: message.priority,
        at: message.at,
        ttlMs: message.ttlMs,
      });
    }
  };
  socket.onclose = (event) => {
    const terminal = terminalCloseMessage(event.code);
    if (terminal) { void display(terminal); return; }
    setTimeout(connect, retryMs);
    retryMs = Math.min(30_000, retryMs * 2);
  };
}

bridge.onEvenHubEvent((event) => {
  const eventType = event.textEvent?.eventType;
  if (eventType === undefined) return;
  const gesture = gestureFromEventType(eventType);
  if (gesture) void controller.gesture(gesture);
});

await connect();
