/**
 * Top bar — high-density micro-typography, status readouts in monospace.
 * Spec: DesignGuide §6.2.
 */
export function Header({ instanceCount }: { instanceCount: number }) {
  return (
    <header className="flex items-center justify-between px-4 py-2 border-b border-grid-bounds bg-bg-surface">
      <div className="flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-signal-high shadow-[0_0_4px_#4cf5a0]" />
        <h1 className="text-xs font-semibold tracking-[0.2em] text-zinc-200 uppercase">
          kern
        </h1>
      </div>
      <div className="flex items-center gap-4 text-[11px] text-zinc-500">
        <span>
          instances{" "}
          <span className="text-zinc-300 tabular-nums">{instanceCount}</span>
        </span>
        <span className="text-signal-low">·</span>
        <span className="text-signal-low">host nominal</span>
      </div>
    </header>
  );
}
