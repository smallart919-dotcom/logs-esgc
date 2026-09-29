import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Server-side lookup: planespotters blocks direct browser requests.
export const getAircraftPhoto = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ hex: z.string().regex(/^[A-F0-9]{6}$/) }).parse(d))
  .handler(async ({ data }) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(`https://api.planespotters.net/pub/photos/hex/${data.hex}`, {
        signal: ctrl.signal,
        headers: { "User-Agent": "ESGC-Logs/1.0" },
      });
      clearTimeout(t);
      if (!r.ok) return null;
      const j = (await r.json()) as { photos?: Array<{ thumbnail_large?: { src: string }; photographer?: string; link?: string }> };
      const p = j.photos?.[0];
      if (!p?.thumbnail_large?.src) return null;
      return { url: p.thumbnail_large.src, photographer: p.photographer ?? "", link: p.link ?? "" };
    } catch {
      return null;
    }
  });
