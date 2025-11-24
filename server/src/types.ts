import type WebSocket from 'ws';

export type ClientRole = 'agent' | 'viewer' | 'observer';

export interface AgentMetadata {
  deviceName: string;
  os: string;
  region?: string;
  version?: string;
  capabilities?: string[];
}

export interface ClientContext {
  id: string;
  role: ClientRole;
  socket: WebSocket;
  sessionCode?: string;
  nickname?: string;
  lastHeartbeat: number;
  meta?: Record<string, unknown>;
}

export interface SessionRecord {
  code: string;
  agent: ClientContext;
  createdAt: number;
  expiresAt: number;
  metadata: AgentMetadata;
  viewers: Map<string, ClientContext>;
  frameQueue: number;
}

