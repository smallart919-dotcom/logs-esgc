import { createStart } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

// Registers the browser bearer-token attacher globally so every protected
// server function call automatically includes the user's Supabase JWT.
export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
}));
