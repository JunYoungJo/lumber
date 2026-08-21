import { useId } from "react";

export function Mark({ size, className }: { size: number; className?: string }) {
  const bgId = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1c2234" />
          <stop offset="0.55" stopColor="#0e1119" />
          <stop offset="1" stopColor="#08090d" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="1008" height="1008" rx="230" fill={`url(#${bgId})`} />
      <rect x="18" y="18" width="988" height="988" rx="220" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="20" />
      <g transform="translate(512 512)" strokeLinecap="round" fill="none">
        <circle r="408" stroke="#5ab7ff" strokeWidth="62" transform="rotate(150)" strokeDasharray="1330 130 973.5 130" />
        <circle r="294" stroke="#8b93ff" strokeWidth="62" transform="rotate(-35)" strokeDasharray="1717 130.3" />
        <circle r="180" stroke="#d7dbff" strokeWidth="62" />
        <circle r="84" fill="#ffb340" />
      </g>
    </svg>
  );
}
