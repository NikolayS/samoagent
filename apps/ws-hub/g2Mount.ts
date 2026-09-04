import type { ServerWebSocket } from "bun";
import { G2Relay, isG2Path, type G2Socket } from "./g2Relay.ts";

export interface G2SocketData {
  kind: "g2-app" | "g2-agent";
  roomId?: string;
}

interface G2UpgradeServer {
  upgrade(request: Request, options: { data: G2SocketData }): boolean;
  requestIP(request: Request): { address: string } | null;
}

export function g2ClientIp(request: Request, peerAddress: string | undefined): string {
  if (peerAddress === "127.0.0.1" || peerAddress === "::1" || peerAddress === "::ffff:127.0.0.1") {
    return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || peerAddress;
  }
  return peerAddress ?? "unknown";
}

/** Mount the complete G2 HTTP and WebSocket surface onto a Bun server. */
export function createG2Mount(relay = new G2Relay()) {
  return {
    async fetch(request: Request, server: G2UpgradeServer): Promise<Response | undefined | null> {
      const path = new URL(request.url).pathname;
      if (path === "/g2/ws") {
        return server.upgrade(request, { data: { kind: "g2-app" } })
          ? undefined
          : new Response("expected a websocket upgrade", { status: 426 });
      }
      const agent = /^\/g2\/rooms\/([^/]+)\/agent$/.exec(path);
      if (agent) {
        return server.upgrade(request, {
          data: { kind: "g2-agent", roomId: agent[1] },
        })
          ? undefined
          : new Response("expected a websocket upgrade", { status: 426 });
      }
      if (!isG2Path(path)) return null;
      return relay.fetch(request, g2ClientIp(request, server.requestIP(request)?.address));
    },

    open(ws: ServerWebSocket<G2SocketData>): void {
      if (ws.data.kind === "g2-app") relay.openApp(ws as unknown as G2Socket);
      else relay.openAgent(ws as unknown as G2Socket, ws.data.roomId!);
    },

    message(ws: ServerWebSocket<G2SocketData>, message: string | Buffer): void {
      if (ws.data.kind === "g2-app") {
        relay.messageApp(ws as unknown as G2Socket, message);
      } else {
        relay.messageAgent(ws as unknown as G2Socket, message);
      }
    },

    close(ws: ServerWebSocket<G2SocketData>): void {
      if (ws.data.kind === "g2-app") relay.closeApp(ws as unknown as G2Socket);
      else relay.closeAgent(ws as unknown as G2Socket);
    },
  };
}
