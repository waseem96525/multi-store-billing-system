// A self-contained, lightweight "green forest" backdrop rendered as an
// inline SVG (no external assets). Sits fixed behind the whole app with a
// soft, misty palette so white content cards stay readable on top.
const trees = [
  { x: 40, y: 712, s: 1.25 },
  { x: 150, y: 740, s: 0.95 },
  { x: 250, y: 700, s: 1.35 },
  { x: 360, y: 745, s: 0.85 },
  { x: 470, y: 712, s: 1.15 },
  { x: 600, y: 752, s: 0.9 },
  { x: 720, y: 705, s: 1.3 },
  { x: 840, y: 748, s: 1.0 },
  { x: 960, y: 710, s: 1.2 },
  { x: 1080, y: 750, s: 0.95 },
  { x: 1190, y: 706, s: 1.3 },
  { x: 1310, y: 745, s: 1.05 },
  { x: 1400, y: 720, s: 1.15 },
];

export default function ForestBackground() {
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none">
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        className="w-full h-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="fSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#eafaf0" />
            <stop offset="45%" stopColor="#bfe6c9" />
            <stop offset="100%" stopColor="#7cc88f" />
          </linearGradient>
          <radialGradient id="fSun" cx="78%" cy="18%" r="38%">
            <stop offset="0%" stopColor="#fffbe6" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#fffbe6" stopOpacity="0" />
          </radialGradient>
          <symbol id="fPine" viewBox="0 0 40 80">
            <rect x="17" y="56" width="6" height="24" fill="#1c5a36" />
            <polygon points="20,4 35,40 5,40" fill="#1f6b3f" />
            <polygon points="20,20 38,58 2,58" fill="#1c5a36" />
          </symbol>
        </defs>

        <rect width="1440" height="900" fill="url(#fSky)" />
        <rect width="1440" height="900" fill="url(#fSun)" />

        {/* Layered hills for depth */}
        <path
          d="M0,560 C240,500 480,540 720,520 C960,500 1200,560 1440,520 L1440,900 L0,900 Z"
          fill="#86c98f"
          opacity="0.7"
        />
        <path
          d="M0,660 C260,610 520,665 760,640 C1020,615 1220,680 1440,640 L1440,900 L0,900 Z"
          fill="#4fae6b"
          opacity="0.85"
        />

        {/* Soft mist bands */}
        <ellipse cx="420" cy="650" rx="360" ry="26" fill="#ffffff" opacity="0.25" />
        <ellipse cx="1040" cy="700" rx="420" ry="30" fill="#ffffff" opacity="0.18" />

        {/* Near hill + tree line */}
        <path
          d="M0,780 C300,730 560,795 820,772 C1080,750 1260,802 1440,770 L1440,900 L0,900 Z"
          fill="#2f8f54"
        />
        {trees.map((t, i) => (
          <use
            key={i}
            href="#fPine"
            x={t.x}
            y={t.y}
            width={40 * t.s}
            height={80 * t.s}
          />
        ))}
      </svg>
    </div>
  );
}
