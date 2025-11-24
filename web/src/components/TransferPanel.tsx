import { useRef } from 'react';
import { Upload } from 'lucide-react';
import type { RemoteSessionApi } from '../types/remote';

interface Props {
  session: RemoteSessionApi;
}

export const TransferPanel = ({ session }: Props) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handlePick = () => {
    inputRef.current?.click();
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      session.sendFile(file).catch((error) => {
        console.error(error);
      });
    }
    event.target.value = '';
  };

  return (
    <section className="glass-panel space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">
            File bridge
          </p>
          <p className="text-lg font-semibold text-white">Transfer queue</p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-2xl border border-white/15 px-3 py-2 text-sm text-white/80 transition hover:border-aurora/60 hover:text-white"
          onClick={handlePick}
          disabled={session.status !== 'connected'}
        >
          <Upload className="h-4 w-4" />
          Send file
        </button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={handleChange}
        />
      </div>

      <div className="space-y-3 text-sm">
        {session.transfers.length === 0 && (
          <p className="text-white/50">No transfers yet.</p>
        )}
        {session.transfers.map((transfer) => (
          <article
            key={transfer.id}
            className="rounded-2xl border border-white/5 bg-white/3 p-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-white">{transfer.name}</p>
                <p className="text-xs text-white/50">
                  {transfer.direction === 'outbound' ? 'To host' : 'To you'} ·{' '}
                  {formatBytes(transfer.size)}
                </p>
              </div>
              <span className="text-xs uppercase tracking-widest text-white/50">
                {transfer.status}
              </span>
            </div>
            <div className="mt-3 h-2 w-full rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-aurora transition-all"
                style={{ width: `${Math.round(transfer.progress * 100)}%` }}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

