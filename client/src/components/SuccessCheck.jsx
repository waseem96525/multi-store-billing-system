export default function SuccessCheck({ className = '' }) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <svg viewBox="0 0 52 52" className="w-16 h-16" aria-hidden="true">
        <circle
          cx="26"
          cy="26"
          r="24"
          fill="none"
          stroke="#10b981"
          strokeWidth="3"
          className="check-circle"
        />
        <path
          fill="none"
          stroke="#10b981"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14 27l8 8 16-16"
          className="check-mark"
        />
      </svg>
    </div>
  );
}
