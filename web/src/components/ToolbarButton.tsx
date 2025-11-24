import type { ReactNode } from 'react';
import clsx from 'clsx';

interface ToolbarButtonProps {
  icon: ReactNode;
  label: string;
  hotkey?: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

export const ToolbarButton = ({
  icon,
  label,
  hotkey,
  active,
  onClick,
  disabled,
}: ToolbarButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={clsx(
      'group flex flex-col items-center justify-center gap-1 rounded-xl border px-3 py-2 text-xs font-medium transition',
      active
        ? 'border-aurora text-white shadow-glow'
        : 'border-white/10 text-white/70 hover:border-white/30 hover:text-white',
      disabled && 'cursor-not-allowed opacity-40 hover:border-white/10',
    )}
  >
    <div className="text-lg">{icon}</div>
    <span className="text-[11px] uppercase tracking-wide">{label}</span>
    {hotkey && (
      <span className="rounded border border-white/15 px-1 text-[10px] text-white/60">
        {hotkey}
      </span>
    )}
  </button>
);

