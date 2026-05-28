import { useEffect, useState } from "react";

/**
 * Fixed, full-bleed background band that shifts colour based on UK local
 * hour: pre-dawn navy → sunrise amber → mid-day sky → dusk magenta → night.
 * Sits at the top of every page behind the sticky header, blending into the
 * existing page gradient. A small orb (sun by day, moon by night) drifts
 * across to anchor the time-of-day cue.
 */
function ukHour(): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hour12: false,
  });
  const h = parseInt(fmt.format(new Date()), 10);
  return Number.isFinite(h) ? h % 24 : 12;
}

type Palette = {
  top: string;
  mid: string;
  bot: string;
  orb: string;
  orbGlow: string;
  isNight: boolean;
};

function paletteFor(h: number): Palette {
  // Six bands across the day
  if (h < 5)
    return { top: "oklch(0.18 0.08 270)", mid: "oklch(0.22 0.10 260)", bot: "oklch(0.30 0.10 250)", orb: "oklch(0.95 0.01 240)", orbGlow: "oklch(0.85 0.12 250)", isNight: true };
  if (h < 8)
    return { top: "oklch(0.55 0.13 40)", mid: "oklch(0.72 0.18 55)", bot: "oklch(0.85 0.14 80)", orb: "oklch(0.85 0.18 70)", orbGlow: "oklch(0.78 0.20 55)", isNight: false };
  if (h < 12)
    return { top: "oklch(0.78 0.10 230)", mid: "oklch(0.85 0.08 220)", bot: "oklch(0.93 0.04 215)", orb: "oklch(0.95 0.14 95)", orbGlow: "oklch(0.85 0.18 85)", isNight: false };
  if (h < 16)
    return { top: "oklch(0.70 0.13 235)", mid: "oklch(0.80 0.10 225)", bot: "oklch(0.90 0.06 220)", orb: "oklch(0.95 0.14 95)", orbGlow: "oklch(0.85 0.18 85)", isNight: false };
  if (h < 19)
    return { top: "oklch(0.50 0.14 280)", mid: "oklch(0.65 0.18 25)", bot: "oklch(0.78 0.16 60)", orb: "oklch(0.78 0.20 35)", orbGlow: "oklch(0.70 0.22 25)", isNight: false };
  if (h < 21)
    return { top: "oklch(0.30 0.10 270)", mid: "oklch(0.42 0.14 295)", bot: "oklch(0.58 0.16 320)", orb: "oklch(0.78 0.16 30)", orbGlow: "oklch(0.62 0.18 25)", isNight: false };
  return { top: "oklch(0.14 0.06 265)", mid: "oklch(0.18 0.08 260)", bot: "oklch(0.25 0.09 250)", orb: "oklch(0.96 0.01 240)", orbGlow: "oklch(0.82 0.10 250)", isNight: true };
}

export function HorizonGradient() {
  const [h, setH] = useState<number>(() => ukHour());
  useEffect(() => {
    const id = setInterval(() => setH(ukHour()), 5 * 60_000);
    return () => clearInterval(id);
  }, []);
  const p = paletteFor(h);
  const orbX = Math.min(95, Math.max(5, (h / 24) * 100));
  const orbY = p.isNight ? 22 : 18 + Math.abs(12 - h) * 1.6;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[44vh] overflow-hidden"
      style={{
        background: `linear-gradient(180deg, ${p.top} 0%, ${p.mid} 45%, ${p.bot} 75%, transparent 100%)`,
        opacity: 0.55,
        maskImage: "linear-gradient(180deg, black 0%, black 60%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(180deg, black 0%, black 60%, transparent 100%)",
      }}
    >
      {/* Sun / moon orb */}
      <div
        className="absolute size-20 rounded-full horizon-orb"
        style={{
          left: `${orbX}%`,
          top: `${orbY}%`,
          background: `radial-gradient(circle at 35% 35%, ${p.orb}, ${p.orbGlow} 60%, transparent 75%)`,
          filter: `drop-shadow(0 0 32px ${p.orbGlow})`,
          transform: "translate(-50%, -50%)",
        }}
      />
      {/* Star sparkle layer for night */}
      {p.isNight && (
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "radial-gradient(1px 1px at 12% 18%, white, transparent 50%)," +
              "radial-gradient(1px 1px at 28% 42%, white, transparent 50%)," +
              "radial-gradient(1px 1px at 47% 22%, white, transparent 50%)," +
              "radial-gradient(1px 1px at 63% 38%, white, transparent 50%)," +
              "radial-gradient(1px 1px at 78% 14%, white, transparent 50%)," +
              "radial-gradient(1px 1px at 88% 31%, white, transparent 50%)",
          }}
        />
      )}
    </div>
  );
}
