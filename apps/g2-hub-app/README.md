# samograph Even Hub app

The phone WebView keeps a WebSocket to the in-memory relay. Relay restarts invalidate rooms; the app then displays a fresh pairing code.

```sh
bun install
cd apps/g2-hub-app
bun run dev
evenhub-simulator http://localhost:5173
evenhub qr --url http://<LAN-IP>:5173
```

For an end-to-end check, open the app, run `samograph g2-pair CODE`, start `samograph g2-listen`, then send `samograph g2-whisper "hello"`. CLICK confirms, DOUBLE_CLICK dismisses, SCROLL_BOTTOM advances, and SCROLL_TOP asks for more.
