# samograph Even Hub app

The phone WebView keeps a WebSocket to the in-memory relay. Relay restarts invalidate rooms; the app then displays a fresh pairing code.

```sh
bun install
G2_RELAY_HOST=0.0.0.0 bun run g2:relay

# In a second terminal:
cd apps/g2-hub-app
VITE_SAMOGRAPH_G2_RELAY=http://<LAN-IP>:8890 bun run dev -- --host 0.0.0.0
evenhub-simulator http://localhost:5173
evenhub qr --url http://<LAN-IP>:5173
```

For a phone test, open the app, export `SAMOGRAPH_G2_RELAY=http://<LAN-IP>:8890`, and run `samograph g2-pair CODE`. Start `samograph g2-listen`, then send `samograph g2-whisper "hello"`. CLICK confirms, DOUBLE_CLICK dismisses, SCROLL_BOTTOM advances, and SCROLL_TOP asks for more.
