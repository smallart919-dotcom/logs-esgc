import { useEffect, useState } from "react";

/**
 * Centered droplet → tick splash.
 * Trigger from anywhere with: window.dispatchEvent(new Event("save-splash"))
 */
export function SaveSplash() {
  const [key, setKey] = useState(0);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const handler = () => {
      setKey((k) => k + 1);
      setOn(true);
      // Total animation ~1500ms
      const t = setTimeout(() => setOn(false), 1700);
      return () => clearTimeout(t);
    };
    window.addEventListener("save-splash", handler);
    return () => window.removeEventListener("save-splash", handler);
  }, []);

  if (!on) return null;

  return (
    <div
      key={key}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center"
    >
      <svg width="160" height="160" viewBox="0 0 160 160" className="save-splash-svg">
        <defs>
          <radialGradient id="dropFill" cx="50%" cy="40%" r="60%">
            <stop offset="0%"  stopColor="var(--sky)" stopOpacity="0.95" />
            <stop offset="60%" stopColor="var(--primary)" stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--sky-deep)" stopOpacity="1" />
          </radialGradient>
        </defs>

        {/* Expanding ripple */}
        <circle className="splash-ripple" cx="80" cy="80" r="20"
                fill="none" stroke="var(--primary)" strokeWidth="2" />
        <circle className="splash-ripple splash-ripple-2" cx="80" cy="80" r="20"
                fill="none" stroke="var(--sky)" strokeWidth="1.5" />

        {/* Droplet that falls and squashes into the tick */}
        <path className="splash-drop"
              d="M80 20 C 92 44, 104 60, 104 76 a24 24 0 1 1 -48 0 C 56 60, 68 44, 80 20 Z"
              fill="url(#dropFill)" />

        {/* Checkmark drawn after droplet lands */}
        <path className="splash-tick"
              d="M52 84 L72 104 L112 64"
              fill="none"
              stroke="var(--primary)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeLinejoin="round" />
      </svg>
    </div>
  );
}
