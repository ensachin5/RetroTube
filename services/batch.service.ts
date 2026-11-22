import { EventEmitter } from "node:events";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { BatchItemRow, BatchRow } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { AppError, ERROR_CODES } from "@/lib/errors";
import { buildSafeOutputFilename, sanitizeFilenameSegment } from "@/lib/filename";
import { logger } from "@/lib/logger";
import { batchItemsRepo } from "@/repositories/batch-items.repo";
import { batchesRepo } from "@/repositories/batches.repo";
import { jobsRepo } from "@/repositories/jobs.repo";
import { diskService } from "./disk.service";
import { fetchService } from "./fetch.service";
import { matchFormatForPreset } from "./format.normalizer";
import { jobService } from "./job.service";
import type { PlaylistItemDTO } from "./playlist.service";

export interface BatchProgressPayload {
  batchId: string;
  status: BatchRow["status"];
  totalItems: number;
  completedItems: number;
  failedItems: number;
  progressPct: number;
  currentItem?: {
    itemId: number;
    youtubeId: string;
    title: string;
    progressPct: number;
    stage: string;
    speed?: string | null;
    etaSec?: number | null;
  };
}

export type BatchEventType =
  | "batch_progress"
  | "item_progress"
  | "item_done"
  | "item_failed"
  | "batch_done"
  | "batch_cancelled";

export interface BatchEvent {
  type: BatchEventType;
  batchId: string;
  data: Record<string, unknown>;
}

export class BatchService {
  private activeBatches = new Set<string>();
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  public subscribeBatch(
    batchId: string,
    listener: (event: BatchEvent) => void,
  ): () => void {
    const eventName = `batch:${batchId}`;
    this.emitter.on(eventName, listener);
    return () => {
      this.emitter.off(eventName, listener);
    };
  }

  private emitBatchEvent(batchId: string, event: BatchEvent): void {
    this.emitter.emit(`batch:${batchId}`, event);
  }

  public async createBatch(params: {
    playlistId: string;
    sourceUrl: string;
    title: string;
    channel: string;
    selectedItemIds: string[];
    items: PlaylistItemDTO[];
    qualityPreset: string;
    kind: "video" | "audio";
    targetContainer: string;
    requestId?: string;
  }): Promise<{
    batchId: string;
    status: BatchRow["status"];
    itemCount: number;
    selectedCount: number;
    qualityPreset: string;
    eventsUrl: string;
    zipUrl: string;
  }> {
    const batchId = crypto.randomUUID();

    const selectedSet = new Set(params.selectedItemIds);
    const selectAll = params.selectedItemIds.includes("all");

    const selectedItems = params.items.filter((item) => {
      if (!item.isAvailable) return false;
      return selectAll || selectedSet.has(item.youtubeId);
    });

    if (selectedItems.length === 0) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        status: 400,
        message: "No available videos were selected for this batch.",
      });
    }

    const batch = batchesRepo.create({
      id: batchId,
      sourceUrl: params.sourceUrl,
      youtubePlaylistId: params.playlistId,
      title: params.title || "Untitled Playlist",
      channel: params.channel || "Unknown Curator",
      itemCount: params.items.length,
      selectedCount: selectedItems.length,
      qualityPreset: params.qualityPreset,
      kind: params.kind,
      targetContainer: params.targetContainer,
      status: "queued",
      createdAt: Date.now(),
    });

    const itemsToInsert = selectedItems.map((item) => ({
      batchId,
      position: item.position,
      youtubeId: item.youtubeId,
      title: item.title,
      durationSec: item.durationSec,
      status: "queued" as const,
      retryCount: 0,
    }));

    batchItemsRepo.createMany(itemsToInsert);

    logger.info("Batch created and enqueued", {
      requestId: params.requestId,
      batchId,
      playlistId: params.playlistId,
      selectedCount: selectedItems.length,
      qualityPreset: params.qualityPreset,
    });

    // Start background processing
    void this.processBatch(batchId);

    return {
      batchId,
      status: batch.status,
      itemCount: batch.itemCount,
      selectedCount: batch.selectedCount,
      qualityPreset: batch.qualityPreset,
      eventsUrl: `/api/batch/${batchId}/events`,
      zipUrl: `/api/batch/${batchId}/zip`,
    };
  }

  public async processBatch(batchId: string): Promise<void> {
    if (this.activeBatches.has(batchId)) {
      return;
    }

    this.activeBatches.add(batchId);
    batchesRepo.updateStatus(batchId, "running");

    const env = getEnv();

    try {
      while (this.activeBatches.has(batchId)) {
        const item = batchItemsRepo.findNextQueuedItem(batchId);
        if (!item) {
          // Check if any items are still in running state
          const counts = batchItemsRepo.countByStatus(batchId);
          if (!counts["running"] || counts["running"] === 0) {
            // All items resolved!
            const finishedAt = Date.now();
            batchesRepo.updateStatus(batchId, "done", finishedAt);
            this.emitBatchEvent(batchId, {
              type: "batch_done",
              batchId,
              data: { status: "done", finishedAt },
            });
            break;
          }
          // Sleep briefly while concurrent items finish
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }

        // Add randomized jitter delay between items to avoid rate limits
        if (env.BATCH_ITEM_DELAY_MS > 0) {
          const jitter =
            env.BATCH_ITEM_DELAY_MS * (0.8 + Math.random() * 0.4);
          await new Promise((r) => setTimeout(r, jitter));
        }

        // Check if batch was cancelled while sleeping
        if (!this.activeBatches.has(batchId)) {
          break;
        }

        await this.processItem(batchId, item);
      }
    } catch (err) {
      logger.error("Error during batch queue execution", {
        batchId,
        error: err,
      });
    } finally {
      this.activeBatches.delete(batchId);
    }
  }

  private async processItem(
    batchId: string,
    item: BatchItemRow,
  ): Promise<void> {
    const env = getEnv();
    const batch = batchesRepo.findById(batchId);
    if (!batch) return;

    batchItemsRepo.updateStatus(item.id, "running");
    this.emitBatchEvent(batchId, {
      type: "item_progress",
      batchId,
      data: {
        itemId: item.id,
        youtubeId: item.youtubeId,
        status: "running",
        progressPct: 0,
        stage: "inspecting",
      },
    });

    try {
      const canonicalUrl = `https://www.youtube.com/watch?v=${item.youtubeId}`;
      const videoResult = await fetchService.fetchMetadata(canonicalUrl, `batch-${item.id}`);

      const matched = matchFormatForPreset(
        [
          ...videoResult.videoFormats.map((f) => ({
            id: f.id,
            videoId: videoResult.video.id,
            formatId: f.formatId,
            kind: f.kind,
            container: f.container,
            vcodec: f.vcodec,
            acodec: f.acodec,
            resolution: f.resolution,
            width: f.width,
            height: f.height,
            fps: f.fps,
            bitrateKbps: f.bitrateKbps,
            filesizeBytes: f.filesizeBytes,
            isHdr: f.isHdr,
            formatNote: f.formatNote,
          })),
          ...videoResult.audioFormats.map((f) => ({
            id: f.id,
            videoId: videoResult.video.id,
            formatId: f.formatId,
            kind: f.kind,
            container: f.container,
            vcodec: null,
            acodec: f.acodec,
            resolution: null,
            width: null,
            height: null,
            fps: null,
            bitrateKbps: f.bitrateKbps,
            filesizeBytes: f.filesizeBytes,
            isHdr: false,
            formatNote: f.formatNote,
          })),
        ],
        batch.qualityPreset,
        batch.kind,
        batch.targetContainer,
      );

      const sourceFormatId = matched.format?.formatId ?? "best";
      const targetContainer = matched.targetContainer;
      const targetBitrateKbps = matched.targetBitrateKbps ?? null;
      const needsMerge = matched.needsMerge;

      const estimatedBytes = diskService.estimateJobBytes(
        matched.format?.filesizeBytes,
        needsMerge,
      );
      await diskService.assertSufficientDisk(estimatedBytes);

      const outputFilename = buildSafeOutputFilename({
        title: item.title,
        qualityTag: matched.actualQuality,
        extension: targetContainer,
      });

      const jobId = crypto.randomUUID();
      jobsRepo.create({
        id: jobId,
        videoId: videoResult.video.id,
        formatId: matched.format?.id ?? null,
        batchItemId: item.id,
        sourceFormatId,
        targetContainer,
        targetBitrateKbps,
        needsMerge,
        status: "queued",
        progressPct: 0,
        outputFilename,
        createdAt: Date.now(),
      });

      batchItemsRepo.updateStatus(item.id, "running", { jobId });

      // Enqueue job and listen to progress
      jobService.enqueue(jobId);

      const result = await jobService.waitForJobCompletion(jobId, (evt) => {
        this.emitBatchEvent(batchId, {
          type: "item_progress",
          batchId,
          data: {
            itemId: item.id,
            youtubeId: item.youtubeId,
            status: evt.status,
            progressPct: evt.progressPct,
            stage: evt.stage,
            speed: evt.speed,
            etaSec: evt.etaSec,
          },
        });
      });

      if (result.status === "done") {
        const finishedJob = jobsRepo.findById(jobId);

        // Optional server save directory
        if (env.SERVER_SAVE_DIR && finishedJob?.tempFilepath) {
          try {
            const saveDir = path.resolve(
              env.SERVER_SAVE_DIR,
              sanitizeFilenameSegment(batch.title),
            );
            await fsp.mkdir(saveDir, { recursive: true });
            const destPath = path.join(saveDir, outputFilename);
            await fsp.copyFile(finishedJob.tempFilepath, destPath);
            logger.info("Saved batch item to server directory", {
              batchId,
              itemId: item.id,
              destPath,
            });
          } catch (saveErr) {
            logger.warn("Failed to copy item to SERVER_SAVE_DIR", {
              batchId,
              itemId: item.id,
              error: saveErr,
            });
          }
        }

        batchItemsRepo.updateStatus(item.id, "done", { jobId });
        this.emitBatchEvent(batchId, {
          type: "item_done",
          batchId,
          data: {
            itemId: item.id,
            youtubeId: item.youtubeId,
            status: "done",
            streamUrl: `/api/download/${jobId}/stream`,
            outputFilename,
            actualFormat: matched.actualQuality,
            bytesTotal: result.bytesTotal,
          },
        });
      } else {
        // Job failed or cancelled
        await this.handleItemFailure(
          batchId,
          item,
          result.errorCode || "DOWNLOAD_FAILED",
        );
      }
    } catch (itemErr) {
      const appErr =
        itemErr instanceof AppError
          ? itemErr
          : new AppError({
              code: ERROR_CODES.YTDLP_FAILED,
              status: 502,
              message: "Failed to process item.",
              cause: itemErr,
            });

      await this.handleItemFailure(batchId, item, appErr.code);
    }
  }

  private async handleItemFailure(
    batchId: string,
    item: BatchItemRow,
    errorCode: string,
  ): Promise<void> {
    if (item.retryCount < 2) {
      batchItemsRepo.incrementRetry(item.id);
      batchItemsRepo.updateStatus(item.id, "queued");
      logger.warn("Retrying failed batch item with backoff", {
        batchId,
        itemId: item.id,
        retryCount: item.retryCount + 1,
        errorCode,
      });
      // Exponential backoff: 2s -> 4s
      await new Promise((r) =>
        setTimeout(r, 2000 * Math.pow(2, item.retryCount)),
      );
    } else {
      batchItemsRepo.updateStatus(item.id, "failed", { errorCode });
      this.emitBatchEvent(batchId, {
        type: "item_failed",
        batchId,
        data: {
          itemId: item.id,
          youtubeId: item.youtubeId,
          status: "failed",
          errorCode,
        },
      });
    }
  }

  public async cancelBatch(batchId: string): Promise<BatchRow | null> {
    this.activeBatches.delete(batchId);

    const items = batchItemsRepo.findByBatchId(batchId);
    for (const item of items) {
      if (item.status === "running" && item.jobId) {
        try {
          await jobService.cancel(item.jobId);
        } catch {
          // Ignore if already cancelled
        }
      }
      if (item.status === "queued" || item.status === "running") {
        batchItemsRepo.updateStatus(item.id, "cancelled");
      }
    }

    const updated = batchesRepo.updateStatus(batchId, "cancelled", Date.now());
    this.emitBatchEvent(batchId, {
      type: "batch_cancelled",
      batchId,
      data: { status: "cancelled" },
    });

    return updated;
  }

  public retryFailedItems(batchId: string): { retryingCount: number } {
    const count = batchItemsRepo.resetFailedToQueued(batchId);
    if (count > 0) {
      batchesRepo.updateStatus(batchId, "running");
      void this.processBatch(batchId);
    }
    return { retryingCount: count };
  }

  public async recoverInterruptedBatches(): Promise<void> {
    const batches = batchesRepo.findUnfinishedBatches();
    if (batches.length === 0) return;

    logger.info("Recovering unfinished batches after server startup", {
      count: batches.length,
    });

    for (const batch of batches) {
      const items = batchItemsRepo.findByBatchId(batch.id);
      for (const item of items) {
        if (item.status === "running") {
          // Reset running items back to queued so they resume with yt-dlp --continue
          batchItemsRepo.updateStatus(item.id, "queued");
        }
      }
      void this.processBatch(batch.id);
    }
  }
}

export const batchService = new BatchService();
