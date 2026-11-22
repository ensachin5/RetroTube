import { and, desc, eq, isNotNull, notInArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { formats, type FormatRow, type NewFormatRow } from "@/db/schema";

export type FormatInsertInput = Omit<NewFormatRow, "id" | "videoId">;

export const formatsRepo = {
  findById(id: number): FormatRow | null {
    const db = getDb();
    return db.select().from(formats).where(eq(formats.id, id)).get() ?? null;
  },

  findByVideoAndFormatId(videoId: number, formatId: string): FormatRow | null {
    const db = getDb();
    return (
      db
        .select()
        .from(formats)
        .where(and(eq(formats.videoId, videoId), eq(formats.formatId, formatId)))
        .get() ?? null
    );
  },

  listByVideoId(videoId: number): FormatRow[] {
    const db = getDb();
    return db.select().from(formats).where(eq(formats.videoId, videoId)).all();
  },

  findBestAudioForVideo(videoId: number): FormatRow | null {
    const db = getDb();
    return (
      db
        .select()
        .from(formats)
        .where(
          and(
            eq(formats.videoId, videoId),
            eq(formats.kind, "audio"),
            isNotNull(formats.acodec),
          ),
        )
        .orderBy(desc(formats.bitrateKbps), desc(formats.filesizeBytes))
        .get() ?? null
    );
  },

  replaceForVideo(videoId: number, items: FormatInsertInput[]): FormatRow[] {
    const db = getDb();
    return db.transaction((tx) => {
      if (items.length === 0) {
        tx.delete(formats).where(eq(formats.videoId, videoId)).run();
        return [];
      }

      const incomingFormatIds = items.map((item) => item.formatId);

      for (const item of items) {
        tx.insert(formats)
          .values({
            videoId,
            ...item,
          })
          .onConflictDoUpdate({
            target: [formats.videoId, formats.formatId],
            set: {
              kind: item.kind,
              container: item.container,
              vcodec: item.vcodec ?? null,
              acodec: item.acodec ?? null,
              resolution: item.resolution ?? null,
              width: item.width ?? null,
              height: item.height ?? null,
              fps: item.fps ?? null,
              bitrateKbps: item.bitrateKbps ?? null,
              filesizeBytes: item.filesizeBytes ?? null,
              isHdr: item.isHdr ?? false,
              formatNote: item.formatNote ?? null,
            },
          })
          .run();
      }

      tx.delete(formats)
        .where(
          and(
            eq(formats.videoId, videoId),
            notInArray(formats.formatId, incomingFormatIds),
          ),
        )
        .run();

      return tx.select().from(formats).where(eq(formats.videoId, videoId)).all();
    });
  },
};
