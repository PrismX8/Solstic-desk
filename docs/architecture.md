# Solstice Desk – Architecture Notes

## Components

| Component | Responsibility |
|-----------|----------------|
| **Relay Server (`server`)** | Hosts REST API + WebSocket relay. Issues session codes, validates viewers, routes screen frames, control events, chat messages, and file chunks. Maintains TTL caches, telemetry, and policy enforcement. |
| **Desktop Agent (`agent`)** | Runs on the controlled machine. Captures the desktop via `mss`, encodes frames to JPEG, pushes them upstream. Applies mouse/keyboard events via `pyautogui`, persists received files, and emits chat + telemetry. |
| **Control Center (`web`)** | Browser UI for viewers (and optionally hosts) to join sessions, view realtime video, send inputs, chat, and manage files. Provides presence indicators, toolbar controls, and responsive layout. |
| **Desktop Viewer/Host (`desktop`)** | Electron shell that embeds the Control Center bundle and, on Windows, provides native capture/input services. Users can pick *Share* (the main process starts the host WebSocket, screen capture loop, and Win32 input shim) or *Connect* (renderer loads the viewer UI). |

All modules communicate over WebSockets using JSON envelopes. Binary file chunks are base64 encoded to keep the protocol simple.

## Message schema

```ts
type Envelope<T extends string, P = unknown> = {
  type: T;
  sessionCode?: string;
  ref?: string;           // correlation id
  payload: P;
};
```

Key message types:

| Direction | Type | Payload |
|-----------|------|---------|
| agent → server | `register_agent` | device metadata, capabilities, auth token (future) |
| server → agent | `session_ready` | issued code, expiresAt |
| viewer → server | `viewer_join` | session code, nickname |
| server → viewer | `session_accept` | device info, constraints |
| agent ↔ viewer | `frame` | `{ mime: "image/jpeg", data: "<base64>", width, height, bytes, timestamp }` |
| viewer → agent | `input_event` | `{ kind, ... }` (mouse move, wheel, key press, text input) |
| bidirectional | `chat_message` | `{ message, sender, ts }` |
| bidirectional | `file_chunk` | `{ fileId, name, index, total, data }` |
| heartbeat | `heartbeat` | `{ rtt, cpu, fps }` |

## Session lifecycle

1. Agent connects to `ws://server/ws?role=agent` and announces itself.
2. Server issues a 6-digit session code and stores metadata (`SessionStore`).
3. Viewer connects to the WS endpoint (or uses REST to validate) and sends `viewer_join`.
4. Server links viewer socket to the session, notifies the agent, and begins relaying.
5. Agent streams frames (throttled by FPS + delta hashing). Server forwards to all viewers.
6. Viewer sends control events/chat/file-chunks, which are validated and relayed to the agent.
7. Idle timers or explicit disconnects tear down the session.

## Policies

- **TTL**: Sessions expire after `SESSION_TTL_MS`. Expired codes are never reused until cleanup.
- **Heartbeat**: Clients must send `heartbeat` at least every `WS_HEARTBEAT_MS`. Missing beats trigger disconnect.
- **Access control**: Currently a shared secret session code. Hooks exist to plug OAuth or signed invites.
- **Rate limits**: Frame bursts are capped (`MAX_FRAME_QUEUE`) to avoid overwhelming viewers. Control events are debounced.

## File transfer flow

1. Sender issues `file_offer` with metadata (name, size, mime).
2. Receiver acknowledges (auto-accept for now).
3. Sender transmits `file_chunk` messages (64 KiB each). Receiver reassembles and writes to disk (agent) or triggers download blob (web).
4. Completion event broadcasts to activity log.

## Deployment considerations

- Server is stateless; horizontal scaling works if a shared session store (Redis) replaces the in-memory map.
- WebSockets should ideally sit behind a reverse proxy (NGINX, Caddy) with TLS termination.
- TURN/WebRTC transport can replace the current JPEG push for bandwidth efficiency and lower latency.
- Agent currently trusts the server blindly; production deployments should sign binaries and implement mutual TLS.

## Testing strategy

- **Server**: Jest tests around `SessionStore`, policy enforcement, and message routing (todo).
- **Agent**: Use mock capture + virtual pointer drivers for CI; integration tests stub out `pyautogui`.
- **Web**: React Testing Library for hooks/components, Cypress for end-to-end viewer journeys.

