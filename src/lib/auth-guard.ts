import { supabase } from "@/integrations/supabase/client";
import { redirect } from "@tanstack/react-router";

export async function requireAuth() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw redirect({ to: "/auth" });
}
