import { customAlphabet } from 'nanoid';
import { config } from '../config.js';
import type { AgentMetadata, ClientContext, SessionRecord } from '../types.js';

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;
const generateCode = customAlphabet(CODE_ALPHABET, CODE_LENGTH);

export class SessionStore {
  private sessions = new Map<string, SessionRecord>();
  private clientToCode = new Map<string, string>();

  createSession(agent: ClientContext, metadata: AgentMetadata): SessionRecord {
    this.removeStale();

    let code = generateCode();
    while (this.sessions.has(code)) {
      code = generateCode();
    }

    const now = Date.now();
    const record: SessionRecord = {
      code,
      agent,
      createdAt: now,
      expiresAt: now + config.sessionTtlMs,
      metadata,
      viewers: new Map(),
      frameQueue: 0,
    };

    agent.sessionCode = code;
    this.sessions.set(code, record);
    this.clientToCode.set(agent.id, code);
    return record;
  }

  getSessionByCode(code: string): SessionRecord | undefined {
    this.removeStale();
    return this.sessions.get(code);
  }

  getSessionByClientId(clientId: string): SessionRecord | undefined {
    const code = this.clientToCode.get(clientId);
    return code ? this.sessions.get(code) : undefined;
  }

  attachViewer(code: string, viewer: ClientContext): SessionRecord {
    this.removeStale();
    const session = this.sessions.get(code);
    if (!session) {
      throw new Error('SESSION_NOT_FOUND');
    }
    if (session.viewers.size >= config.maxViewers) {
      throw new Error('SESSION_FULL');
    }
    viewer.sessionCode = code;
    session.viewers.set(viewer.id, viewer);
    this.clientToCode.set(viewer.id, code);
    return session;
  }

  detachClient(clientId: string): SessionRecord | undefined {
    const code = this.clientToCode.get(clientId);
    if (!code) {
      return undefined;
    }
    const session = this.sessions.get(code);
    if (!session) {
      this.clientToCode.delete(clientId);
      return undefined;
    }

    if (session.agent.id === clientId) {
      session.viewers.forEach((viewer) => viewer.socket.close(4001, 'Host disconnected'));
      this.sessions.delete(code);
      session.viewers.clear();
    } else if (session.viewers.has(clientId)) {
      session.viewers.delete(clientId);
    }

    this.clientToCode.delete(clientId);
    return session;
  }

  markFrameQueued(code: string): boolean {
    const session = this.sessions.get(code);
    if (!session) return false;
    if (session.frameQueue >= config.maxFrameQueue) {
      return false;
    }
    session.frameQueue += 1;
    return true;
  }

  markFrameDelivered(code: string): void {
    const session = this.sessions.get(code);
    if (!session) return;
    session.frameQueue = Math.max(0, session.frameQueue - 1);
  }

  removeStale(): void {
    const now = Date.now();
    for (const [code, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        session.agent.socket.close(4000, 'Session expired');
        session.viewers.forEach((viewer) => viewer.socket.close(4000, 'Session expired'));
        this.sessions.delete(code);
        this.clientToCode.delete(session.agent.id);
        session.viewers.forEach((viewer) => this.clientToCode.delete(viewer.id));
      }
    }
  }

  stats(): { sessions: number; viewers: number } {
    this.removeStale();
    let viewerCount = 0;
    for (const session of this.sessions.values()) {
      viewerCount += session.viewers.size;
    }
    return {
      sessions: this.sessions.size,
      viewers: viewerCount,
    };
  }
}

