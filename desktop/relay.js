const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const DEFAULT_PORT = Number(process.env.SOLSTICE_RELAY_PORT || 17654);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 15 * 60 * 1000);
const MAX_VIEWERS = Number(process.env.MAX_VIEWERS || 3);

const sessions = new Map();
const clients = new Map();

const send = (socket, message) => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
};

const makeCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
};

const createSession = (agent, metadata) => {
  let code = makeCode();
  while (sessions.has(code)) code = makeCode();
  const session = {
    code,
    agent,
    metadata,
    viewers: new Map(),
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  agent.sessionCode = code;
  sessions.set(code, session);
  return session;
};

const detachClient = (clientId) => {
  const ctx = clients.get(clientId);
  if (!ctx) return null;
  clients.delete(clientId);

  if (ctx.role === 'agent' && ctx.sessionCode) {
    const session = sessions.get(ctx.sessionCode);
    if (session) {
      session.viewers.forEach((viewer) => {
        send(viewer.socket, {
          type: 'session_rejected',
          payload: { reason: 'Host disconnected' },
        });
      });
      sessions.delete(ctx.sessionCode);
      return session;
    }
  }

  if (ctx.role === 'viewer' && ctx.sessionCode) {
    const session = sessions.get(ctx.sessionCode);
    if (session) {
      session.viewers.delete(ctx.id);
      send(session.agent.socket, {
        type: 'viewer_left',
        payload: { viewerId: ctx.id, totalViewers: session.viewers.size },
      });
      return session;
    }
  }

  return null;
};

const removeExpiredSessions = () => {
  const now = Date.now();
  sessions.forEach((session, code) => {
    if (session.expiresAt > now) return;
    send(session.agent.socket, {
      type: 'error',
      payload: { reason: 'Session expired' },
    });
    session.viewers.forEach((viewer) => {
      send(viewer.socket, {
        type: 'session_rejected',
        payload: { reason: 'Session expired' },
      });
    });
    sessions.delete(code);
  });
};

const handleHttp = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', name: 'Solstice Desk Local Relay' }));
    return;
  }

  const match = req.url?.match(/^\/api\/sessions\/([^/?#]+)/);
  if (match && req.method === 'GET') {
    const code = decodeURIComponent(match[1]).toUpperCase();
    const session = sessions.get(code);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'NOT_FOUND' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        code: session.code,
        deviceName: session.metadata.deviceName,
        os: session.metadata.os,
        region: session.metadata.region,
        expiresAt: session.expiresAt,
        viewers: session.viewers.size,
        createdAt: session.createdAt,
      }),
    );
    return;
  }

  if (match && req.method === 'DELETE') {
    const code = decodeURIComponent(match[1]).toUpperCase();
    const session = sessions.get(code);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'NOT_FOUND' }));
      return;
    }
    detachClient(session.agent.id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'revoked' }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'NOT_FOUND' }));
};

const handleMessage = (ctx, raw) => {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return;
  }

  const payload = message.payload || {};
  switch (message.type) {
    case 'announce_agent': {
      if (ctx.role !== 'observer') return;
      ctx.role = 'agent';
      ctx.meta = {
        deviceName: String(payload.deviceName || 'Solstice Host'),
        os: String(payload.os || process.platform),
        region: String(payload.region || 'local'),
        capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
      };
      const session = createSession(ctx, ctx.meta);
      send(ctx.socket, {
        type: 'session_ready',
        payload: { code: session.code, expiresAt: session.expiresAt },
      });
      break;
    }

    case 'viewer_join': {
      const code = String(payload.code || '').trim().toUpperCase();
      const session = sessions.get(code);
      if (!session) {
        send(ctx.socket, {
          type: 'session_rejected',
          payload: { reason: 'Session not found' },
        });
        return;
      }
      if (session.viewers.size >= MAX_VIEWERS) {
        send(ctx.socket, {
          type: 'session_rejected',
          payload: { reason: 'Session is full' },
        });
        return;
      }
      ctx.role = 'viewer';
      ctx.nickname = String(payload.nickname || 'Viewer');
      ctx.sessionCode = code;
      session.viewers.set(ctx.id, ctx);
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
          nickname: ctx.nickname,
          totalViewers: session.viewers.size,
        },
      });
      break;
    }

    case 'frame': {
      if (ctx.role !== 'agent' || !ctx.sessionCode) return;
      const session = sessions.get(ctx.sessionCode);
      if (!session) return;
      session.viewers.forEach((viewer) => {
        if (viewer.socket.bufferedAmount > 512 * 1024) return;
        send(viewer.socket, { type: 'frame', payload });
      });
      break;
    }

    case 'input_event': {
      if (ctx.role !== 'viewer' || !ctx.sessionCode) return;
      const session = sessions.get(ctx.sessionCode);
      if (!session) return;
      send(session.agent.socket, {
        type: 'input_event',
        payload: { ...payload, viewerId: ctx.id },
      });
      break;
    }

    case 'chat_message': {
      if (!ctx.sessionCode) return;
      const session = sessions.get(ctx.sessionCode);
      if (!session) return;
      const outbound = {
        type: 'chat_message',
        payload: { ...payload, sender: ctx.role, timestamp: Date.now() },
      };
      send(session.agent.socket, outbound);
      session.viewers.forEach((viewer) => send(viewer.socket, outbound));
      break;
    }

    case 'file_offer':
    case 'file_chunk': {
      if (!ctx.sessionCode) return;
      const session = sessions.get(ctx.sessionCode);
      if (!session) return;
      const outbound = {
        type: message.type,
        payload: { ...payload, sender: ctx.role, viewerId: ctx.id },
      };
      if (ctx.role === 'agent') {
        session.viewers.forEach((viewer) => send(viewer.socket, outbound));
      } else {
        send(session.agent.socket, outbound);
      }
      break;
    }

    case 'heartbeat':
      ctx.lastHeartbeat = Date.now();
      break;

    default:
      break;
  }
};

function startLocalRelay({ port = DEFAULT_PORT, log = console.log } = {}) {
  const server = http.createServer(handleHttp);
  const wss = new WebSocketServer({ noServer: true });
  const interval = setInterval(removeExpiredSessions, 15_000);

  server.on('upgrade', (request, socket, head) => {
    if (!request.url?.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const ctx = {
        id: randomUUID(),
        role: 'observer',
        socket: ws,
        lastHeartbeat: Date.now(),
      };
      clients.set(ctx.id, ctx);
      ws.on('message', (raw) => handleMessage(ctx, raw));
      ws.on('close', () => detachClient(ctx.id));
      ws.on('error', () => detachClient(ctx.id));
    });
  });

  server.on('close', () => {
    clearInterval(interval);
    wss.close();
  });

  server.listen(port, '127.0.0.1', () => {
    log(`Local relay listening on 127.0.0.1:${port}`);
  });

  server.on('error', (error) => {
    log(`Local relay error: ${error.message}`);
  });

  return {
    close: () => {
      clearInterval(interval);
      wss.close();
      server.close();
    },
  };
}

module.exports = { startLocalRelay };
