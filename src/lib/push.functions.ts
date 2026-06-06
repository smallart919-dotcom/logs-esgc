import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  p256dh: z.string().min(1).max(512),
  auth: z.string().min(1).max(512),
  userAgent: z.string().max(512).optional(),
  notifyProximity: z.boolean().optional(),
  notifyOwnFleet: z.boolean().optional(),
});

export const subscribePush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SubscribeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        user_agent: data.userAgent ?? null,
        notify_proximity: data.notifyProximity ?? true,
        notify_own_fleet: data.notifyOwnFleet ?? true,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
    if (error) throw error;
    return { ok: true };
  });

export const unsubscribePush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ endpoint: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", data.endpoint);
    if (error) throw error;
    return { ok: true };
  });

export const updatePushPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      endpoint: z.string().url(),
      notifyProximity: z.boolean().optional(),
      notifyOwnFleet: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, boolean> = {};
    if (typeof data.notifyProximity === "boolean") patch.notify_proximity = data.notifyProximity;
    if (typeof data.notifyOwnFleet === "boolean") patch.notify_own_fleet = data.notifyOwnFleet;
    const { error } = await context.supabase
      .from("push_subscriptions")
      .update(patch)
      .eq("endpoint", data.endpoint);
    if (error) throw error;
    return { ok: true };
  });

const FirePayload = z.object({
  category: z.enum(["proximity", "own_fleet", "test"]),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(400),
  tag: z.string().max(120).optional(),
  url: z.string().max(512).optional(),
});

/** Authenticated users can trigger a broadcast push (e.g. when their client detects proximity). */
export const firePush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FirePayload.parse(d))
  .handler(async ({ data }) => {
    const { sendToAllSubscribers } = await import("./push-send.server");
    return sendToAllSubscribers(data.category, {
      title: data.title,
      body: data.body,
      tag: data.tag,
      url: data.url ?? "/map",
    });
  });
