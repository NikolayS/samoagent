import { afterEach, describe, expect, it } from "bun:test";
import type { G2RelayServerHandle } from "./g2-relay-server.ts";
import { startG2RelayServer } from "./g2-relay-server.ts";

interface Inbox {
  socket: WebSocket;
  next(type: string): Promise<any>;
}

function connect(url: string): Promise<Inbox> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const queued: any[] = [];
    const waiters: Array<{ type: string; resolve: (message: any) => void }> = [];
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      const index = waiters.findIndex((waiter) => waiter.type === message.type);
      if (index >= 0) waiters.splice(index, 1)[0]!.resolve(message);
      else queued.push(message);
    };
    socket.onerror = () => reject(new Error(`WebSocket failed: ${url}`));
    socket.onopen = () => resolve({
      socket,
      next(type) {
        const index = queued.findIndex((message) => message.type === type);
        if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
        return new Promise((resolveMessage) => waiters.push({ type, resolve: resolveMessage }));
      },
    });
  });
}

describe("standalone G2 relay server", () => {
  let handle: G2RelayServerHandle | undefined;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets) socket.close();
    sockets.length = 0;
    await handle?.stop();
    handle = undefined;
  });

  it("serves health and relays pair → whisper → cue over real WebSockets", async () => {
    handle = startG2RelayServer({ port: 0, hostname: "127.0.0.1", logStartup: false });
    expect(await (await fetch(`${handle.url}/g2/health`)).text()).toBe("ok");
    expect((await fetch(`${handle.url}/health`)).status).toBe(404);

    const app = await connect(handle.url.replace("http:", "ws:") + "/g2/ws");
    sockets.push(app.socket);
    const { code } = await app.next("code");

    const pairResponse = await fetch(`${handle.url}/g2/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(pairResponse.status).toBe(200);
    const credentials = await pairResponse.json() as { room_id: string; room_token: string };
    await app.next("paired");

    const agent = await connect(
      handle.url.replace("http:", "ws:") + `/g2/rooms/${credentials.room_id}/agent`,
    );
    sockets.push(agent.socket);
    agent.socket.send(JSON.stringify({ type: "auth", token: credentials.room_token }));

    const whisperResponse = await fetch(
      `${handle.url}/g2/rooms/${credentials.room_id}/whisper`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${credentials.room_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: "hello", priority: "normal" }),
      },
    );
    expect(whisperResponse.status).toBe(200);
    expect(await app.next("whisper")).toMatchObject({ text: "hello" });

    app.socket.send(JSON.stringify({ type: "cue", cue: "confirm" }));
    expect(await agent.next("cue")).toEqual({ type: "cue", cue: "confirm" });
  });
});
