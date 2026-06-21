import { useState } from 'react';
import clsx from 'clsx';
import { ArrowRight, Link2, LoaderCircle, Monitor, Unplug } from 'lucide-react';
import type { RemoteSessionApi } from '../types/remote';

interface Props {
  session: RemoteSessionApi;
}

const statusCopy: Record<RemoteSessionApi['status'], { label: string; dot: string }> = {
  idle: { label: 'Ready to connect', dot: 'bg-white/25' },
  connecting: { label: 'Connecting…', dot: 'bg-amber-300' },
  connected: { label: 'Connected', dot: 'bg-emerald-400' },
  error: { label: 'Connection failed', dot: 'bg-rose-400' },
};

export const ConnectionPanel = ({ session }: Props) => {
  const [code, setCode] = useState('');
  const status = statusCopy[session.status];
  const busy = session.status === 'connecting';
  const connected = session.status === 'connected';

  const handleConnect = (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedCode = code.trim().toUpperCase();
    if (normalizedCode.length < 4) return;
    session.connect(normalizedCode, 'Viewer');
  };

  return (
    <section className="glass-panel flex min-h-[300px] flex-col p-6 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-aurora">
            <Link2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-white">Connect to a computer</h2>
            <p className="mt-1 text-sm leading-6 text-white/50">Enter the code shown on the other computer.</p>
          </div>
        </div>
        <span className="hidden items-center gap-2 whitespace-nowrap text-xs text-white/45 sm:inline-flex">
          <span className={clsx('h-1.5 w-1.5 rounded-full', status.dot)} />
          {status.label}
        </span>
      </div>

      <form onSubmit={handleConnect} className="mt-8">
        <label htmlFor="session-code" className="mb-2 block text-xs font-medium text-white/55">
          Access code
        </label>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <input
            id="session-code"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-4 py-3.5 font-mono text-lg font-semibold uppercase tracking-[0.16em] text-white outline-none transition placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-white/25 focus:border-aurora/60 focus:ring-4 focus:ring-aurora/10"
            placeholder="Enter code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            maxLength={8}
            autoComplete="off"
            spellCheck={false}
            required
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-aurora px-5 py-3.5 text-sm font-semibold text-[#08111f] transition hover:bg-white"
            disabled={busy || connected}
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {busy ? 'Connecting' : connected ? 'Connected' : 'Connect'}
          </button>
        </div>
      </form>

      {session.error && (
        <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {session.error}
        </div>
      )}

      <div className="mt-auto pt-6">
        {connected ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
            <div className="flex min-w-0 items-center gap-3 text-sm">
              <Monitor className="h-4 w-4 shrink-0 text-emerald-300" />
              <div className="min-w-0">
                <p className="truncate font-medium text-white">{session.deviceName || 'Remote computer'}</p>
                <p className="text-xs text-white/40">{session.fps || 0} fps · {session.latency || 0} ms</p>
              </div>
            </div>
            <button
              type="button"
              onClick={session.disconnect}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-white/60 transition hover:border-rose-300/30 hover:bg-rose-500/10 hover:text-rose-200"
            >
              <Unplug className="h-3.5 w-3.5" />
              Disconnect
            </button>
          </div>
        ) : (
          <p className="border-t border-white/[0.07] pt-4 text-xs text-white/35">
            The connection is encrypted directly between both computers.
          </p>
        )}
      </div>
    </section>
  );
};
