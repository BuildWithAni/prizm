/**
 * Legacy low-poly prism artwork. The hero and CTA band now use the WebGL
 * `PrismScene` instead — this file is kept only as a static fallback asset.
 */
export default function PrismArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 560 560" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="pa-glow-white" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="pa-glow-silver" cx="50%" cy="50%">
          <stop offset="0%" stopColor="#D9D9D9" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#D9D9D9" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pa-facet-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.5" stopColor="#B9B9B9" />
          <stop offset="1" stopColor="#3A3A3A" />
        </linearGradient>
        <linearGradient id="pa-facet-b" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E6E6E6" />
          <stop offset="1" stopColor="#404040" />
        </linearGradient>
        <linearGradient id="pa-facet-c" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#CFCFCF" />
          <stop offset="1" stopColor="#4A4A4A" />
        </linearGradient>
        <linearGradient id="pa-facet-d" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1E1E1E" />
          <stop offset="1" stopColor="#0C0C0C" />
        </linearGradient>
      </defs>

      {/* glows */}
      <ellipse cx="240" cy="400" rx="250" ry="190" fill="url(#pa-glow-white)" />
      <ellipse cx="410" cy="240" rx="210" ry="180" fill="url(#pa-glow-silver)" />

      {/* dot grid */}
      <g fill="#EDEDED" opacity="0.35">
        {Array.from({ length: 6 }).map((_, row) =>
          Array.from({ length: 9 }).map((__, col) => (
            <circle key={`${row}-${col}`} cx={40 + col * 22} cy={430 + row * 18} r="1.4" />
          )),
        )}
      </g>

      {/* prism facets */}
      <g stroke="rgba(255,255,255,0.35)" strokeWidth="1">
        <polygon points="300,70 95,470 300,335" fill="url(#pa-facet-a)" />
        <polygon points="300,70 300,335 520,420" fill="url(#pa-facet-b)" opacity="0.92" />
        <polygon points="95,470 300,335 250,515" fill="url(#pa-facet-d)" />
        <polygon points="300,335 520,420 250,515" fill="url(#pa-facet-c)" opacity="0.85" />
      </g>

      {/* bright inner edge */}
      <g stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round">
        <line x1="300" y1="70" x2="300" y2="335" opacity="0.9" />
        <line x1="300" y1="335" x2="250" y2="515" opacity="0.6" />
      </g>
      <circle cx="300" cy="335" r="10" fill="#FFFFFF" opacity="0.85" />
      <circle cx="300" cy="335" r="22" fill="#FFFFFF" opacity="0.25" />

      {/* scattered wireframes */}
      <g fill="none" stroke="#EDEDED" strokeWidth="1.2">
        <polygon points="80,120 120,175 45,170" opacity="0.5" />
        <polygon points="470,90 515,140 445,140" opacity="0.35" />
        <polygon points="420,505 470,530 430,545" opacity="0.4" />
      </g>
      <g fill="none" stroke="#9A9A9A" strokeWidth="1.2" opacity="0.4">
        <polygon points="150,60 190,95 130,100" />
      </g>
    </svg>
  );
}
