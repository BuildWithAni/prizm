interface LogoProps {
  size?: number;
  showWord?: boolean;
}

/** PRIZM mark — a faceted prism triangle with the green→violet gradient. */
export default function Logo({ size = 26, showWord = false }: LogoProps) {
  return (
    <span className="logo">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="prizm-mark" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="45%" stopColor="#D9D9D9" />
            <stop offset="75%" stopColor="#8C8C8C" />
            <stop offset="100%" stopColor="#F2F2F2" />
          </linearGradient>
        </defs>
        <path
          d="M16 2.5 L30 28.5 H2 Z"
          fill="none"
          stroke="url(#prizm-mark)"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path d="M16 2.5 L16 15 L9 28.5 H2 Z" fill="rgba(124,255,60,0.22)" />
        <path d="M16 15 L30 28.5 H16 Z" fill="rgba(168,85,247,0.28)" />
      </svg>
      {showWord && <span className="logo-word">PRIZM</span>}
    </span>
  );
}
