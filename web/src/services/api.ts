import ky from 'ky';

const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, '') ?? 'http://localhost:8080';

const client = ky.create({
  prefixUrl: API_BASE,
  timeout: 8000,
});

export interface SessionMeta {
  code: string;
  deviceName: string;
  os: string;
  region?: string;
  expiresAt: number;
  viewers: number;
  createdAt: number;
}

export function fetchSessionMeta(code: string) {
  return client.get(`api/sessions/${code}`).json<SessionMeta>();
}

