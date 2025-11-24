import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { logger } from '../lib/logger.js';
import { SessionStore } from '../lib/sessionStore.js';
import { config } from '../config.js';
import type { ClientContext } from '../types.js';
import {
  agentAnnounceSchema,
  chatPayloadSchema,
  envelopeSchema,
  fileChunkPayloadSchema,
  fileOfferPayloadSchema,
  framePayloadSchema,
  heartbeatPayloadSchema,
  inputEventSchema,
  viewerJoinSchema,
} from './schemas.js';
import { send } from './utils.js';

export const sessionStore = new SessionStore();

export function registerWebSocketServer(httpServer: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    if (!request.url?.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit('connection', client, request);
    });
  });

  wss.on('connection', (socket, request) => {
    const ctx: ClientContext = {
      id: uuid(),
      role: 'observer',
      socket,
      lastHeartbeat: Date.now(),
    };

    logger.info({ id: ctx.id, ip: request.socket.remoteAddress }, 'ws_connected');

    socket.on('message', (raw) => {
      handleMessage(raw.toString(), ctx);
    });

    socket.on('close', () => {
      cleanupClient(ctx, request);
    });

    socket.on('error', (err) => {
      logger.error({ err, clientId: ctx.id }, 'ws_error');
      socket.close();
    });
  });

  const heartbeatInterval = setInterval(() => {
    sessionStore.removeStale();
  }, config.heartbeatMs);

  wss.on('close', () => clearInterval(heartbeatInterval));
}

function cleanupClient(ctx: ClientContext, request: IncomingMessage): void {
  const session = sessionStore.detachClient(ctx.id);
  if (ctx.role === 'viewer' && session) {
    send(session.agent.socket, {
      type: 'viewer_left',
      payload: { viewerId: ctx.id, totalViewers: session.viewers.size },
    });
  }
  logger.info(
    { id: ctx.id, role: ctx.role, ip: request.socket.remoteAddress },
    'ws_disconnected',
  );
}

function handleMessage(raw: string, ctx: ClientContext): void {
  let envelope: z.infer<typeof envelopeSchema>;
  try {
    envelope = envelopeSchema.parse(JSON.parse(raw));
  } catch (error) {
    logger.warn({ error, raw }, 'ws_invalid_message');
    return;
  }

  switch (envelope.type) {
    case 'announce_agent':
      handleAgentAnnounce(envelope.payload, ctx);
      break;
    case 'viewer_join':
      handleViewerJoin(envelope.payload, ctx);
      break;
    case 'frame':
      handleFrame(envelope.payload, ctx);
      break;
    case 'input_event':
      handleInputEvent(envelope.payload, ctx);
      break;
    case 'chat_message':
      handleChat(envelope.payload, ctx);
      break;
    case 'file_offer':
      handleFileOffer(envelope.payload, ctx);
      break;
    case 'file_chunk':
      handleFileChunk(envelope.payload, ctx);
      break;
    case 'heartbeat':
      handleHeartbeat(envelope.payload, ctx);
      break;
    default:
      logger.debug({ type: envelope.type }, 'ws_unhandled_type');
  }
}

function handleAgentAnnounce(payload: unknown, ctx: ClientContext): void {
  if (ctx.role !== 'observer') {
    send(ctx.socket, { type: 'error', message: 'Already registered' });
    return;
  }
  const data = agentAnnounceSchema.safeParse(payload);
  if (!data.success) {
    send(ctx.socket, { type: 'error', message: 'Invalid announce payload' });
    return;
  }

  ctx.role = 'agent';
  ctx.meta = data.data;
  const session = sessionStore.createSession(ctx, data.data);
  send(ctx.socket, {
    type: 'session_ready',
    payload: { code: session.code, expiresAt: session.expiresAt },
  });
  logger.info(
    { sessionCode: session.code, agentId: ctx.id, device: data.data.deviceName },
    'session_created',
  );
}

function handleViewerJoin(payload: unknown, ctx: ClientContext): void {
  const data = viewerJoinSchema.safeParse(payload);
  if (!data.success) {
    send(ctx.socket, { type: 'error', message: 'Invalid viewer payload' });
    return;
  }

  const nickname = data.data.nickname.trim();
  const code = data.data.code.trim().toUpperCase();
  try {
    const session = sessionStore.attachViewer(code, ctx);
    ctx.role = 'viewer';
    ctx.nickname = nickname;
    send(ctx.socket, {
      type: 'session_accept',
      payload: {
        code: session.code,
        deviceName: session.metadata.deviceName,
        os: session.metadata.os,
        region: session.metadata.region,
        expiresAt: session.expiresAt,
        viewers: session.viewers.size,
      },
    });

    send(session.agent.socket, {
      type: 'viewer_joined',
      payload: {
        viewerId: ctx.id,
        nickname,
        totalViewers: session.viewers.size,
      },
    });

    logger.info({ code, viewerId: ctx.id }, 'viewer_joined');
  } catch (error) {
    send(ctx.socket, {
      type: 'session_rejected',
      payload: { reason: (error as Error).message },
    });
  }
}

function handleFrame(payload: unknown, ctx: ClientContext): void {
  if (ctx.role !== 'agent' || !ctx.sessionCode) {
    return;
  }
  const data = framePayloadSchema.safeParse(payload);
  if (!data.success) return;

  if (!sessionStore.markFrameQueued(ctx.sessionCode)) {
    return;
  }

  const session = sessionStore.getSessionByCode(ctx.sessionCode);
  if (!session) return;

  session.viewers.forEach((viewer) => {
    send(viewer.socket, { type: 'frame', payload: data.data });
  });

  sessionStore.markFrameDelivered(ctx.sessionCode);
}

function handleInputEvent(payload: unknown, ctx: ClientContext): void {
  if (ctx.role !== 'viewer' || !ctx.sessionCode) {
    return;
  }
  const data = inputEventSchema.safeParse(payload);
  if (!data.success) return;

  const session = sessionStore.getSessionByCode(ctx.sessionCode);
  if (!session) return;

  send(session.agent.socket, {
    type: 'input_event',
    payload: { ...data.data, viewerId: ctx.id },
  });
}

function handleChat(payload: unknown, ctx: ClientContext): void {
  const data = chatPayloadSchema.safeParse(payload);
  if (!data.success || !ctx.sessionCode) return;

  const session = sessionStore.getSessionByCode(ctx.sessionCode);
  if (!session) return;

  const message = {
    type: 'chat_message',
    payload: {
      ...data.data,
      sender: ctx.role,
      timestamp: Date.now(),
    },
  };

  send(session.agent.socket, message);
  session.viewers.forEach((viewer) => {
    send(viewer.socket, message);
  });
}

function handleFileOffer(payload: unknown, ctx: ClientContext): void {
  const data = fileOfferPayloadSchema.safeParse(payload);
  if (!data.success || !ctx.sessionCode) return;
  const session = sessionStore.getSessionByCode(ctx.sessionCode);
  if (!session) return;
  const message = {
    type: 'file_offer',
    payload: { ...data.data, sender: ctx.role },
  };

  const targets =
    ctx.role === 'agent'
      ? Array.from(session.viewers.values())
      : [session.agent];

  targets.forEach((client) => send(client.socket, message));
}

function handleFileChunk(payload: unknown, ctx: ClientContext): void {
  const data = fileChunkPayloadSchema.safeParse(payload);
  if (!data.success || !ctx.sessionCode) return;
  const session = sessionStore.getSessionByCode(ctx.sessionCode);
  if (!session) return;

  if (ctx.role === 'agent') {
    session.viewers.forEach((client) => {
      send(client.socket, {
        type: 'file_chunk',
        payload: { ...data.data, sender: ctx.role },
      });
    });
  } else {
    send(session.agent.socket, {
      type: 'file_chunk',
      payload: { ...data.data, sender: ctx.role, viewerId: ctx.id },
    });
  }
}

function handleHeartbeat(payload: unknown, ctx: ClientContext): void {
  const data = heartbeatPayloadSchema.safeParse(payload);
  if (!data.success) return;
  ctx.lastHeartbeat = Date.now();

  if (ctx.role === 'viewer' && ctx.sessionCode) {
    const session = sessionStore.getSessionByCode(ctx.sessionCode);
    if (session) {
      send(session.agent.socket, {
        type: 'viewer_heartbeat',
        payload: { viewerId: ctx.id, ...data.data },
      });
    }
  }
}

