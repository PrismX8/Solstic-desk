import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ClipboardCheck, Copy, Gauge, ShieldCheck, WifiOff, Zap } from 'lucide-react';
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
  const [viewMode, setViewMode] = useState<'control' | 'view'>('control');
  const [clipboardSync, setClipboardSync] = useState(true);
  const [quality, setQuality] = useState<'balanced' | 'performance' | 'lossless'>(
    'balanced',
  );
  const [transferMode, setTransferMode] = useState<'full' | 'download' | 'upload'>(
    'full',
  );
  const [deskId, setDeskId] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const normalizedCode = code.trim().toUpperCase();

  useEffect(() => {
    const existingId =
      typeof window !== 'undefined' ? localStorage.getItem('solstice-desk-id') : null;
    if (existingId) {
      setDeskId(existingId);
      return;
    }
    const randomId = Array.from({ length: 9 })
      .map(() => Math.floor(Math.random() * 10))
      .join('');
    setDeskId(randomId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('solstice-desk-id', randomId);
    }
  }, []);

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
    session.connect(code.trim().toUpperCase(), nickname || 'Viewer', {
      viewOnly: viewMode === 'view',
      clipboardSync,
      fileTransfer: transferMode,
      quality,
    });
  };

  const handleCopyDeskId = async () => {
    if (!deskId) return;
    try {
      await navigator.clipboard.writeText(deskId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      console.error('copy failed', err);
    }
  };

  return (
    <section className="glass-panel relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(94,240,255,0.15),transparent_55%)]" />
      <div className="relative z-10 grid gap-6 p-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-[1fr_1.1fr]">
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.35em] text-white/50">
                This Desk
              </p>
              <p className="text-xs text-white/60">Ready for unattended access</p>
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="rounded-full bg-aurora/15 p-2 text-aurora">
                  <Gauge className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-white/50">
                    Your address
                  </p>
                  <p className="text-2xl font-semibold text-white tabular-nums">
                    {deskId || '•••'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyDeskId}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 text-white/80 transition hover:border-white/40 hover:text-white"
                  aria-label="Copy desk ID"
                >
                  {copied ? <ClipboardCheck className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                </button>
              </div>
            </div>
            <div className="grid h-full grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.28em] text-white/50">
                  Permissions
                </p>
                <p className="text-sm text-white/70">Input, clipboard & file transfer enabled</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.28em] text-white/50">
                  Network
                </p>
                <p className="text-sm text-white/70">Low-latency relay with TLS</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleConnect} className="space-y-4 rounded-2xl border border-white/10 bg-white/3 p-5">
            <p className="text-xs uppercase tracking-[0.4em] text-white/50">
              Remote Desk
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-white/70">
                Desk ID
                <input
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none ring-aurora/40 focus:ring"
                  placeholder="123 456 789"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={9}
                  autoComplete="off"
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-white/70">
                Your Alias
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
                    <p className="font-semibold text-white">{preview.deviceName}</p>
                    <p className="text-xs uppercase tracking-[0.4em] text-white/50">
                      {preview.os} · expires {new Date(preview.expiresAt).toLocaleTimeString()}
                    </p>
                  </>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
                Mode
                <div className="flex gap-2 text-xs font-semibold text-white">
                  <button
                    type="button"
                    onClick={() => setViewMode('control')}
                    className={clsx(
                      'flex-1 rounded-lg px-3 py-2 transition',
                      viewMode === 'control'
                        ? 'bg-aurora text-[#041016] shadow-glow'
                        : 'bg-white/5 text-white/70 hover:bg-white/10',
                    )}
                  >
                    Control
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('view')}
                    className={clsx(
                      'flex-1 rounded-lg px-3 py-2 transition',
                      viewMode === 'view'
                        ? 'bg-aurora text-[#041016] shadow-glow'
                        : 'bg-white/5 text-white/70 hover:bg-white/10',
                    )}
                  >
                    View only
                  </button>
                </div>
              </label>
              <label className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
                Quality
                <select
                  className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-white outline-none focus:ring"
                  value={quality}
                  onChange={(e) =>
                    setQuality(e.target.value as 'balanced' | 'performance' | 'lossless')
                  }
                >
                  <option value="balanced">Balanced</option>
                  <option value="performance">Performance</option>
                  <option value="lossless">Original quality</option>
                </select>
              </label>
              <label className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
                File access
                <select
                  className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-white outline-none focus:ring"
                  value={transferMode}
                  onChange={(e) =>
                    setTransferMode(e.target.value as 'full' | 'download' | 'upload')
                  }
                >
                  <option value="full">Send & receive</option>
                  <option value="download">Receive only</option>
                  <option value="upload">Send only</option>
                </select>
              </label>
            </div>

            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80">
              <input
                type="checkbox"
                className="h-4 w-4 accent-aurora"
                checked={clipboardSync}
                onChange={(e) => setClipboardSync(e.target.checked)}
              />
              Clipboard sync & keyboard passthrough
            </label>

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
        </div>

        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/3 p-5 backdrop-blur-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">Status</p>
              <p className={clsx('text-2xl font-semibold', status.tone)}>{status.label}</p>
              <p className="text-xs text-white/60">
                {session.connectOptions.viewOnly ? 'Viewing remote desk' : 'Full control'} ·
                {` ${session.connectOptions.quality}`}
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
                <p className="text-lg font-semibold text-white">{metric.value}</p>
              </div>
            ))}
            <div className="rounded-xl border border-white/5 bg-white/2 px-4 py-3">
              <p className="text-xs uppercase tracking-widest text-white/40">Clipboard</p>
              <p className="text-lg font-semibold text-white">
                {session.connectOptions.clipboardSync ? 'Synced' : 'Isolated'}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/2 px-4 py-3">
              <p className="text-xs uppercase tracking-widest text-white/40">Files</p>
              <p className="text-lg font-semibold text-white">
                {session.connectOptions.fileTransfer === 'full'
                  ? 'Send / receive'
                  : session.connectOptions.fileTransfer === 'upload'
                    ? 'Send only'
                    : 'Receive only'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

