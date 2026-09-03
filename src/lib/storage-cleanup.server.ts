import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Deletes files in the private `logs-exports` bucket older than `days` days.
 * Called from the nightly CnG sync hook so shared spreadsheets don't pile up
 * and consume Cloud storage forever.
 */
export async function purgeOldLogExports(days = 35): Promise<{ removed: number; error?: string }> {
  const bucket = "logs-exports";
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const toRemove: string[] = [];

  // List the date-prefixed folders (uploads are stored as "YYYY-MM-DD/uuid-name.xlsx").
  const { data: folders, error: fErr } = await supabaseAdmin.storage.from(bucket).list("", { limit: 1000 });
  if (fErr) return { removed: 0, error: fErr.message };

  for (const folder of folders ?? []) {
    // Folders come back with no id; files have one. Folder name is the date.
    const folderTime = Date.parse(`${folder.name}T00:00:00Z`);
    if (Number.isNaN(folderTime)) continue;
    if (folderTime >= cutoff) continue; // recent folder — keep everything in it

    const { data: files, error: lErr } = await supabaseAdmin.storage.from(bucket).list(folder.name, { limit: 1000 });
    if (lErr) return { removed: toRemove.length, error: lErr.message };
    for (const f of files ?? []) {
      toRemove.push(`${folder.name}/${f.name}`);
    }
  }

  let removed = 0;
  // Remove in batches of 100.
  for (let i = 0; i < toRemove.length; i += 100) {
    const batch = toRemove.slice(i, i + 100);
    const { error } = await supabaseAdmin.storage.from(bucket).remove(batch);
    if (error) return { removed, error: error.message };
    removed += batch.length;
  }

  return { removed };
}
