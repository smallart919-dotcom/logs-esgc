import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";


export type NotamRecord = {
  id: string;
  notam_ref: string;
  kind: string;
  centre_lat: number;
  centre_lon: number;
  radius_nm: number | null;
  polygon: Array<[number, number]> | null;
  lower_ft: number | null;
  upper_ft: number | null;
  valid_from: string | null;
  valid_to: string | null;
  description: string;
  source: string;
};

/** Public: list currently active NOTAMs/TRAs/Danger Areas. */
export const listActiveNotams = createServerFn({ method: "GET" }).handler(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { notams: [] as NotamRecord[] };
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("notams")
    .select(
      "id,notam_ref,kind,centre_lat,centre_lon,radius_nm,polygon,lower_ft,upper_ft,valid_from,valid_to,description,source",
    )
    .or(`valid_to.is.null,valid_to.gte.${nowIso}`)
    .order("valid_from", { ascending: true });
  if (error) {
    console.error("listActiveNotams", error);
    return { notams: [] as NotamRecord[] };
  }
  return { notams: (data ?? []) as NotamRecord[] };
});
