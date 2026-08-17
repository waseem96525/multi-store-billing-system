import { useEffect, useRef, useState } from 'react';

// Smoothly animates between the previous and next numeric value using
// requestAnimationFrame. Great for KPI counters and live totals.
export default function CountUp({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  duration = 700,
  className = '',
}) {
  const [display, setDisplay] = useState(Number(value) || 0);
  const fromRef = useRef(Number(value) || 0);
  const rafRef = useRef(null);

  useEffect(() => {
    const to = Number(value) || 0;
    const from = fromRef.current;
    if (from === to) return;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  const formatted = Number(display).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
