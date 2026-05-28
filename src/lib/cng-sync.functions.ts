import { createServerFn } from "@tanstack/react-start";
import { runCngSync } from "@/lib/cng-sync-run.server";

export const cngSyncNow = createServerFn({ method: "POST" })
  .inputValidator((d: { date?: string } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const result = await runCngSync(data ?? {});
    if ("error" in result && result.error) {
      throw new Error(result.error);
    }
    return result;
  });
