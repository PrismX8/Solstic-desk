import type { RemoteSessionApi } from '../types/remote';

interface Props {
  session: RemoteSessionApi;
}

export const ActivityPanel = ({ session }: Props) => (
  <section className="glass-panel space-y-4 p-5">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs uppercase tracking-[0.4em] text-white/40">
          Telemetry
        </p>
        <p className="text-lg font-semibold text-white">Activity log</p>
      </div>
      <span className="text-xs text-white/50">
        TTL: {session.code ? `${session.code}` : '--'}
      </span>
    </div>

    <ol className="space-y-3 text-sm text-white/80">
      {session.activity.length === 0 && (
        <p className="text-white/50">No activity yet.</p>
      )}
      {session.activity.map((entry) => (
        <li
          key={entry.id}
          className="flex items-start justify-between rounded-2xl border border-white/5 bg-white/2 px-4 py-3"
        >
          <div>
            <p className="font-semibold">{entry.label}</p>
            {entry.detail && (
              <p className="text-xs text-white/60">{entry.detail}</p>
            )}
          </div>
          <time className="text-xs text-white/40">
            {new Date(entry.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </time>
        </li>
      ))}
    </ol>
  </section>
);

