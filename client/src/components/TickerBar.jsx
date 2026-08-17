// A seamless scrolling "ticker" banner showing the shop name. The track
// repeats the text and slides by -50% so the loop is continuous.
export default function TickerBar({ name = 'Retail Shop' }) {
  const text = name || 'Retail Shop';
  const repeats = 24;
  return (
    <div className="sticky top-14 lg:top-0 z-20 ticker-fade overflow-hidden bg-gradient-to-r from-red-700 via-black to-red-700 text-white text-sm font-semibold py-1.5 select-none shadow">
      <div className="ticker-track">
        {Array.from({ length: repeats }).map((_, i) => (
          <span key={i} className="px-8 inline-flex items-center gap-2">
            <span className="text-red-500">✦</span>
            {text}
            <span className="text-red-500">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
}
