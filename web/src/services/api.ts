import ky from 'ky';

const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, '') ?? 'http://127.0.0.1:17654';

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

