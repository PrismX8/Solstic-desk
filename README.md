# Solstice Desk

Solstice Desk is a full-stack remote-assistance platform inspired by AnyDesk. It combines a Node.js signalling/relay service, a React/Tailwind front-end, and a Python-powered desktop agent that streams the host screen, relays input, enables chat, and transfers files in both directions.

> ⚠️ **Security notice** – The prototype is meant for local networks or lab scenarios. Before exposing it to the public internet, harden authentication, add TLS, and consider brokered TURN relays or VPN tunnelling.

## Feature set

- One-time session codes with automatic expiry and revocation
- Multi-viewer support with presence indicator and per-viewer quality adaptation
- High-frequency screen streaming with adaptive JPEG quality and delta throttling
- Full-mouse and keyboard control via the Python agent (`pyautogui`)
- Bidirectional chat with typing indicators and delivery receipts
- File transfer pipeline (chunked, resumable) that persists to the host Downloads folder by default
- Viewer experience built with React + Tailwind, including immersive windowed canvas, control toolbar, activity log, and responsive layout
- Health heartbeat, latency telemetry, and connection quality scoring
- Configurable policies (max viewers, max bitrate, idle timeout) loaded from environment variables

## Monorepo layout

```
.
├── agent/        # Python desktop agent (screen capture + input bridge)
├── docs/         # Architecture notes, sequence diagrams, and API docs
├── server/       # Node/TypeScript signalling + relay server
├── web/          # React/Tailwind viewer/control center
├── package.json  # Root workspace scripts
└── README.md
```

## Requirements

| Component | Requirements |
|-----------|--------------|
| Server    | Node.js ≥ 18.18, npm |
| Web UI    | Node.js ≥ 18.18, npm |
| Agent     | Python 3.10+, `pip`, ability to install `mss`, `pyautogui`, `websockets`, `pynput` |

## Quick start

1. **Install JS deps**

   ```bash
   npm install
   ```

2. **Bootstrap server**

   ```bash
   cd server
   cp env.sample .env    # optional overrides
   npm run dev
   ```

3. **Launch the Solstice Desk desktop app (host + viewer in one)**

   - **Dev mode:** run `npm run dev:web` and `npm run dev:desktop` in two terminals. Electron opens immediately and hits the Vite dev server.
   - **Packaged `.exe`:** run `npm run dist:desktop`. Install `desktop/release/Solstice Desk Setup 0.1.0.exe` and open “Solstice Desk” from the Start menu.
   - Inside the app choose **Share my screen** (host) or **Connect** (viewer). Host mode streams your desktop and generates a code automatically; viewer mode reuses the React UI you already saw in the browser.

4. **(Optional) Legacy Python agent**

   You can still run the cross-platform Python agent if you need to host from macOS/Linux:

   ```bash
   cd agent
   pip install -r requirements.txt
   python main.py
   ```

5. **Connect from a viewer**

   - Grab the 6-digit session code shown in the desktop app (or the Python agent console)
   - In Solstice Desk, enter the code and request control
   - The host can stop/pause sharing from the same window at any time

- **Desktop viewer (.exe)**

  Build once and double-click the generated installer:

  ```bash
  npm run dist:desktop
  ```

  The command bundles the latest `web/dist` into an Electron shell and emits a signed NSIS installer in `desktop/release`. Install it on Windows and launch “Solstice Desk” to get a native window that mirrors the browser UI without needing a separate tab.

## Environment variables

| Variable | Component | Default | Purpose |
|----------|-----------|---------|---------|
| `PORT` | server | 8080 | HTTP API + WS upgrade port |
| `WS_HEARTBEAT_MS` | server | 15000 | Expected heartbeat interval |
| `SESSION_TTL_MS` | server | 900000 | Session expiry (15 minutes) |
| `MAX_VIEWERS` | server | 3 | Maximum simultaneous viewers per session |
| `VITE_API_BASE` | web | http://localhost:8080 | REST base URL |
| `VITE_WS_URL` | web | ws://localhost:8080/ws | WebSocket endpoint |
| `SOLSTICE_WS_URL` | desktop | ws://localhost:8080/ws | Relay endpoint for host mode |
| `AGENT_SERVER_URL` | agent | ws://localhost:8080/ws | Relay WebSocket |
| `AGENT_REGION` | agent | local | Region tag used in telemetry |
| `AGENT_FPS` | agent | 8 | Capture frames per second |
| `AGENT_JPEG_QUALITY` | agent | 65 | Lower = higher compression |

## Development scripts

| Command | Description |
|---------|-------------|
| `npm run dev:server` | Start the Node server with hot reload |
| `npm run dev:web` | Start the Vite dev server |
| `npm run dev:desktop` | Launch the Electron viewer (expects `npm run dev:web`) |
| `npm run build` | Build both workspaces |
| `npm run dist:desktop` | Produce a Windows installer via Electron Builder |
| `npm run lint` | Run workspace lint commands |
| `npm run format` | Run prettier/eslint/ruff in workspaces (if configured) |

## Roadmap ideas

- TURN/WebRTC transport for lower latency and better bandwidth utilisation
- Desktop UI wrapper (Electron/PySide) for the agent
- Recording & playback, multi-monitor selection, clipboard sync
- Federated authentication (OIDC) for enterprise deployments
- Observability stack (OpenTelemetry + Prometheus exporter)

## License

Apache-2.0 – see `LICENSE` (to be supplied).

