import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ShieldCheck, WifiOff, Zap } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { RemoteSessionApi } from '../types/remote';
import { fetchSessionMeta } from '../services/api';

interface Props {
  session: RemoteSessionApi;
}

const statusCopy: Record<
  RemoteSessionApi['status'],
  { label: string; tone: string }
> = {
  idle: { label: 'Idle', tone: 'text-white/60' },
  connecting: { label: 'Connecting', tone: 'text-amber-300' },
  connected: { label: 'Connected', tone: 'text-aurora' },
  error: { label: 'Error', tone: 'text-rose-400' },
};

export const ConnectionPanel = ({ session }: Props) => {
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('Command');
  const normalizedCode = code.trim().toUpperCase();

  const { data: preview, isFetching: previewLoading, error: previewError } =
    useQuery({
      queryKey: ['session-meta', normalizedCode],
      queryFn: () => fetchSessionMeta(normalizedCode),
      enabled: normalizedCode.length >= 4 && session.status === 'idle',
      staleTime: 10_000,
    });

  const status = statusCopy[session.status];

  const metrics = useMemo(
    () => [
      { label: 'FPS', value: session.fps ? `${session.fps} fps` : '—' },
      {
        label: 'Latency',
        value: session.latency ? `${session.latency} ms` : 'pending',
      },
      { label: 'Viewers', value: session.viewers || 0 },
      {
        label: 'Device',
        value: session.deviceName
          ? `${session.deviceName} · ${session.os}`
          : 'Waiting for host',
      },
    ],
    [session.deviceName, session.fps, session.latency, session.os, session.viewers],
  );

  const handleConnect = (event: React.FormEvent) => {
    event.preventDefault();
    if (!code || code.trim().length < 4) return;
    session.connect(code.trim().toUpperCase(), nickname || 'Viewer');
  };

  return (
    <section className="glass-panel relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(94,240,255,0.15),transparent_55%)]" />
      <div className="relative z-10 grid gap-6 p-6 lg:grid-cols-[1.2fr_0.8fr]">
        <form onSubmit={handleConnect} className="space-y-4">
          <p className="text-xs uppercase tracking-[0.4em] text-white/50">
            Session Control
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-white/70">
              Session Code
              <input
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none ring-aurora/40 focus:ring"
                placeholder="ABC123"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={8}
                autoComplete="off"
                required
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-white/70">
              Your Call Sign
              <input
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none ring-aurora/40 focus:ring"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={24}
              />
            </label>
          </div>

          {(session.error || previewError) && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">
              {session.error ??
                'Session not found or unavailable. Double-check the code.'}
            </div>
          )}

          {preview && (
            <div className="rounded-2xl border border-aurora/30 bg-aurora/5 px-4 py-3 text-sm text-white/80">
              {previewLoading ? (
                <span>Validating…</span>
              ) : (
                <>
                  <p className="font-semibold text-white">
                    {preview.deviceName}
                  </p>
                  <p className="text-xs uppercase tracking-[0.4em] text-white/50">
                    {preview.os} · expires{' '}
                    {new Date(preview.expiresAt).toLocaleTimeString()}
                  </p>
                </>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-aurora px-4 py-3 font-semibold text-[#041016] shadow-glow transition hover:bg-aurora/90"
              disabled={session.status === 'connecting'}
            >
              <Zap className="h-4 w-4" />
              {session.status === 'connecting' ? 'Establishing...' : 'Connect'}
            </button>
            <button
              type="button"
              onClick={session.disconnect}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm text-white/70 transition hover:border-white/40 hover:text-white"
            >
              <WifiOff className="h-4 w-4" />
              Drop
            </button>
          </div>
        </form>

        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/3 p-5 backdrop-blur-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">
                Status
              </p>
              <p className={clsx('text-2xl font-semibold', status.tone)}>
                {status.label}
              </p>
            </div>
            <ShieldCheck className="h-10 w-10 text-white/30" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {metrics.map((metric) => (
              <div
                key={metric.label}
                className="rounded-xl border border-white/5 bg-white/2 px-4 py-3"
              >
                <p className="text-xs uppercase tracking-widest text-white/40">
                  {metric.label}
                </p>
                <p className="text-lg font-semibold text-white">
                  {metric.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

