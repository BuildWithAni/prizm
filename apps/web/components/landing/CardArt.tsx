export type CardArtVariant = "pyramid" | "wave" | "cubes" | "book";

/** Small low-poly illustrations for the "Why PRIZM" cards (monochrome line art). */
export default function CardArt({ variant }: { variant: CardArtVariant }) {
  if (variant === "pyramid") {
    return (
      <svg viewBox="0 0 160 120" className="card-art" aria-hidden="true">
        <defs>
          <linearGradient id="ca-py" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.45" />
            <stop offset="1" stopColor="#3A3A3A" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        <polygon points="80,14 22,96 138,96" fill="url(#ca-py)" />
        <g fill="none" stroke="#F0F0F0" strokeWidth="1.4">
          <polygon points="80,14 22,96 138,96" opacity="0.9" />
          <line x1="80" y1="14" x2="80" y2="78" opacity="0.7" />
          <line x1="22" y1="96" x2="80" y2="78" opacity="0.5" />
          <line x1="138" y1="96" x2="80" y2="78" opacity="0.5" />
        </g>
        <circle cx="80" cy="78" r="5" fill="#FFFFFF" />
        <circle cx="80" cy="78" r="12" fill="#FFFFFF" opacity="0.25" />
      </svg>
    );
  }

  if (variant === "wave") {
    return (
      <svg viewBox="0 0 160 120" className="card-art" aria-hidden="true">
        <defs>
          <linearGradient id="ca-wv-a" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#C9C9C9" stopOpacity="0.6" />
            <stop offset="1" stopColor="#4A4A4A" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id="ca-wv-b" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#F2F2F2" stopOpacity="0.55" />
            <stop offset="1" stopColor="#3E3E3E" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        <polygon points="8,62 40,38 72,54 104,26 132,48 156,36 156,74 8,74" fill="url(#ca-wv-a)" />
        <polygon points="8,78 40,58 72,72 104,48 132,66 156,56 156,104 8,104" fill="url(#ca-wv-b)" />
        <g fill="none" stroke="#EDEDED" strokeWidth="1" opacity="0.6">
          <polyline points="8,78 40,58 72,72 104,48 132,66 156,56" />
        </g>
        <g fill="#E8E8E8" opacity="0.8">
          <circle cx="104" cy="26" r="2.5" />
          <circle cx="40" cy="38" r="2" />
        </g>
      </svg>
    );
  }

  if (variant === "cubes") {
    const cube = (cx: number, cy: number, s: number, key: string) => {
      const h = s * 0.5;
      return (
        <g key={key} fill="none" stroke="#E0E0E0" strokeWidth="1.2" opacity="0.85">
          <polygon points={`${cx},${cy - s} ${cx + s},${cy - h} ${cx},${cy} ${cx - s},${cy - h}`} opacity="0.5" />
          <polygon points={`${cx - s},${cy - h} ${cx},${cy} ${cx},${cy + s} ${cx - s},${cy + h}`} />
          <polygon points={`${cx + s},${cy - h} ${cx},${cy} ${cx},${cy + s} ${cx + s},${cy + h}`} opacity="0.7" />
        </g>
      );
    };
    return (
      <svg viewBox="0 0 160 120" className="card-art" aria-hidden="true">
        <defs>
          <radialGradient id="ca-cb-glow">
            <stop offset="0%" stopColor="#E0E0E0" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#E0E0E0" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="80" cy="60" r="46" fill="url(#ca-cb-glow)" />
        {cube(80, 60, 26, "c0")}
        {cube(44, 78, 17, "c1")}
        {cube(116, 78, 17, "c2")}
        {cube(80, 22, 14, "c3")}
        <circle cx="80" cy="60" r="3.5" fill="#FFFFFF" />
      </svg>
    );
  }

  // book
  return (
    <svg viewBox="0 0 160 120" className="card-art" aria-hidden="true">
      <defs>
        <linearGradient id="ca-bk-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F2F2F2" />
          <stop offset="1" stopColor="#6E6E6E" />
        </linearGradient>
        <linearGradient id="ca-bk-b" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#333333" />
          <stop offset="1" stopColor="#101010" />
        </linearGradient>
      </defs>
      <polygon points="80,34 18,52 80,70" fill="url(#ca-bk-a)" />
      <polygon points="80,34 142,52 80,70" fill="url(#ca-bk-b)" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
      <polygon points="18,52 80,70 80,102 18,84" fill="url(#ca-bk-a)" opacity="0.85" />
      <polygon points="142,52 80,70 80,102 142,84" fill="#1E1E1E" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
      <line x1="80" y1="70" x2="80" y2="102" stroke="#F0F0F0" strokeWidth="1.5" opacity="0.8" />
    </svg>
  );
}
