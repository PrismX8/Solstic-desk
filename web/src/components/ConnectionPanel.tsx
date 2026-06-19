import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { PlugZap, ShieldCheck, WifiOff, Zap } from 'lucide-react';
import type { RemoteSessionApi } from '../types/remote';

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
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-300 via-sky-300 to-emerald-300" />
      <div className="relative z-10 grid gap-6 p-6 lg:grid-cols-[1.15fr_0.85fr]">
        <form onSubmit={handleConnect} className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-white/50">
              Join Station
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-white">
              Connect to a code
            </h2>
            <p className="text-sm text-white/70">
              Enter the host code to open the live remote surface.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-white/70">
              Session Code
              <input
                className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-white outline-none ring-aurora/40 transition placeholder:text-white/30 focus:border-aurora/40 focus:ring"
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
                className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-white outline-none ring-aurora/40 transition placeholder:text-white/30 focus:border-aurora/40 focus:ring"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={24}
              />
            </label>
          </div>

          {session.error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">
              {session.error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 font-semibold text-[#071016] shadow-[0_16px_40px_rgba(94,240,255,0.2)] transition hover:bg-aurora"
              disabled={session.status === 'connecting'}
            >
              <Zap className="h-4 w-4" />
              {session.status === 'connecting' ? 'Establishing...' : 'Connect'}
            </button>
            <button
              type="button"
              onClick={session.disconnect}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-3 text-sm text-white/70 transition hover:border-white/40 hover:bg-white/5 hover:text-white"
            >
              <WifiOff className="h-4 w-4" />
              Drop
            </button>
          </div>
        </form>

        <div className="space-y-4 rounded-xl border border-white/10 bg-black/20 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">
                Status
              </p>
              <p className={clsx('text-2xl font-semibold', status.tone)}>
                {status.label}
              </p>
            </div>
            {session.status === 'connected' ? (
              <ShieldCheck className="h-10 w-10 text-emerald-300" />
            ) : (
              <PlugZap className="h-10 w-10 text-white/30" />
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {metrics.map((metric) => (
              <div
                key={metric.label}
                className="rounded-lg border border-white/5 bg-white/[0.03] px-4 py-3"
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

