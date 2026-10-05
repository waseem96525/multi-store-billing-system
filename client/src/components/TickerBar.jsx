// Static shop-name banner (scrolling animation disabled).
export default function TickerBar({ name = 'Retail Shop' }) {
  const text = name || 'Retail Shop';
  return (
    <div className="sticky top-14 lg:top-0 z-20 overflow-hidden text-center bg-gradient-to-r from-red-700 via-black to-red-700 text-white text-sm font-semibold py-1.5 select-none shadow">
      <div className="ticker-track">
        <span className="inline-flex items-center gap-2">
          <span className="text-red-500">✦</span>
          {text}
          <span className="text-red-500">✦</span>
        </span>
      </div>
    </div>
  );
}