import { useId } from "react";

/**
 * The Zuuvy Studio mark: Zuuvy's route (brand/studio-mark.svg is the source),
 * whose destination is a page — the signal square carrying a browser bar.
 * Ink is currentColor so it sits on light and dark; the signal keeps its colour.
 */
export function StudioMark({ size = 32, className }: { size?: number; className?: string }) {
  const mask = `zs-studio-${useId()}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} role="img" aria-label="Zuuvy Studio">
      <defs>
        <mask id={mask}>
          <rect width="100" height="100" fill="#fff" />
          <rect x="20.5" y="20.5" width="11" height="11" rx="0.5" fill="#000" />
          <rect x="69.5" y="21.5" width="9" height="9" fill="#000" />
          <rect x="21.5" y="45.5" width="9" height="9" fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${mask})`}>
        <polyline points="26,26 74,26 74,50 26,50 26,74 74,74" fill="none" stroke="currentColor" strokeWidth="11" strokeLinejoin="miter" strokeLinecap="butt" />
      </g>
      <rect x="18" y="18" width="16" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="5" />
      <rect x="64" y="64" width="21" height="21" rx="3.5" fill="#e2503b" />
      <rect x="68" y="68.5" width="13" height="2.6" rx="1.3" fill="#fff" />
    </svg>
  );
}

/** Mark + wordmark, sized by height. */
export function StudioLockup({ height = 28, className }: { height?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`} style={{ height }}>
      <StudioMark size={height} />
      <span className="font-display leading-none tracking-tight" style={{ fontSize: height * 0.56 }}>
        <span className="font-bold">Zuuvy</span> <span className="font-normal">Studio</span>
      </span>
    </span>
  );
}
