import type WebSocket from 'ws';

export function send(
  socket: WebSocket,
  message: Record<string, unknown>,
): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
}

