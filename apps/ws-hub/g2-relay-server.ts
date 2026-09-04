import type { Server } from "bun";
import { stopServerBounded } from "../../packages/shared/serverLifecycle.ts";
import { createG2Mount, type G2SocketData } from "./g2Mount.ts";

export interface G2RelayServerOptions {
  port?: number;
  hostname?: string;
  logStartup?: boolean;
}

export interface G2RelayServerHandle {
  server: Server<G2SocketData>;
  port: number;
  url: string;
  stop(): Promise<void>;
}

export function startG2RelayServer(options: G2RelayServerOptions = {}): G2RelayServerHandle {
  const mount = createG2Mount();
  const server = Bun.serve<G2SocketData>({
    port: options.port ?? 8890,
    hostname: options.hostname ?? "0.0.0.0",
    idleTimeout: 255,
    async fetch(request, bunServer) {
      const response = await mount.fetch(request, bunServer);
      return response === null ? new Response("not found", { status: 404 }) : response;
    },
    websocket: {
      open: mount.open,
      message: mount.message,
      close: mount.close,
    },
  });
  const port = server.port ?? options.port ?? 8890;
  const url = `http://${server.hostname}:${port}`;
  if (options.logStartup !== false) console.info(`G2 relay listening at ${url}`);
  return { server, port, url, stop: () => stopServerBounded(server) };
}

if (import.meta.main) {
  startG2RelayServer({
    port: Number.parseInt(process.env.G2_RELAY_PORT ?? "8890", 10),
    hostname: process.env.G2_RELAY_HOST ?? "0.0.0.0",
  });
}
