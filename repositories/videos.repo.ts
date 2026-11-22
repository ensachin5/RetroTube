import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { videos, type NewVideoRow, type VideoRow } from "@/db/schema";

export const videosRepo = {
  findById(id: number): VideoRow | null {
    const db = getDb();
    return db.select().from(videos).where(eq(videos.id, id)).get() ?? null;
  },

  findByYoutubeId(youtubeId: string): VideoRow | null {
    const db = getDb();
    return db.select().from(videos).where(eq(videos.youtubeId, youtubeId)).get() ?? null;
  },

  upsert(input: Omit<NewVideoRow, "id">): VideoRow {
    const db = getDb();
    return db
      .insert(videos)
      .values(input)
      .onConflictDoUpdate({
        target: videos.youtubeId,
        set: {
          title: input.title,
          channel: input.channel,
          durationSec: input.durationSec,
          uploadDate: input.uploadDate ?? null,
          thumbnailUrl: input.thumbnailUrl,
          fetchedAt: input.fetchedAt,
        },
      })
      .returning()
      .get();
  },
};
