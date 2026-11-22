import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { zipService } from "@/services/zip.service";

describe("ZIP64 > 4 GB Streaming & Memory Boundedness", () => {
  let tempDir: string;
  let sparseFilePath: string;
  const SPARSE_SIZE_BYTES = 4500 * 1024 * 1024; // 4.5 GB

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "retrotube-zip64-test-"));
    sparseFilePath = path.join(tempDir, "huge-sparse-video.mp4");

    // Create a 4.5 GB sparse file (0 actual disk blocks allocated on APFS / ext4)
    const fh = await fsp.open(sparseFilePath, "w");
    await fh.truncate(SPARSE_SIZE_BYTES);
    await fh.close();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("streams > 4.5 GB without memory explosion and writes valid ZIP64 headers", async () => {
    // Force garbage collection if available or take baseline
    if (global.gc) {
      global.gc();
    }
    const initialHeap = process.memoryUsage().heapUsed;
    let peakHeap = initialHeap;

    const zipStream = zipService.createStreamingZip([
      {
        position: 1,
        title: "Retro Synth Concert Live 4K",
        extension: "mp4",
        tempFilepath: sparseFilePath,
      },
    ]);

    const reader = zipStream.getReader();
    let totalBytesStreamed = 0;
    const initialChunkHead: number[] = [];
    let lastChunkTail = Buffer.alloc(0);

    // Stream through the entire 4.5 GB
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytesStreamed += value.length;

        // Collect initial bytes for local header verification
        if (initialChunkHead.length < 64) {
          for (let i = 0; i < value.length && initialChunkHead.length < 64; i++) {
            initialChunkHead.push(value[i]!);
          }
        }

        // Keep a rolling buffer of the last 1024 bytes to inspect central directory and ZIP64 footer
        const combined = Buffer.concat([lastChunkTail, Buffer.from(value)]);
        lastChunkTail = combined.subarray(Math.max(0, combined.length - 1024));

        const currentHeap = process.memoryUsage().heapUsed;
        if (currentHeap > peakHeap) {
          peakHeap = currentHeap;
        }
      }
    }

    // 1. Total bytes streamed must exceed the 4.5 GB file size + headers
    expect(totalBytesStreamed).toBeGreaterThan(SPARSE_SIZE_BYTES);

    // 2. Memory growth must remain strictly bounded (< 50 MB delta) despite streaming 4.5 GB
    const heapDelta = peakHeap - initialHeap;
    expect(heapDelta).toBeLessThan(50 * 1024 * 1024);

    // 3. Verify Local File Header signature: PK\x03\x04 (0x04034b50)
    const headBuf = Buffer.from(initialChunkHead);
    expect(headBuf.readUInt32LE(0)).toBe(0x04034b50);
    // Version needed: 45 (v4.5 for ZIP64)
    expect(headBuf.readUInt16LE(4)).toBe(45);
    // Sizes set to 0xFFFFFFFF in local header
    expect(headBuf.readUInt32LE(18)).toBe(0xffffffff);
    expect(headBuf.readUInt32LE(22)).toBe(0xffffffff);

    // 4. Verify ZIP64 End of Central Directory Record signature: PK\x06\x06 (0x06064b50)
    const z64EocdSig = Buffer.from([0x50, 0x4b, 0x06, 0x06]);
    expect(lastChunkTail.includes(z64EocdSig)).toBe(true);

    // 5. Verify ZIP64 End of Central Directory Locator signature: PK\x06\x07 (0x07064b50)
    const z64LocSig = Buffer.from([0x50, 0x4b, 0x06, 0x07]);
    expect(lastChunkTail.includes(z64LocSig)).toBe(true);

    // 6. Verify Standard End of Central Directory signature: PK\x05\x06 (0x06054b50)
    const standardEocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    expect(lastChunkTail.includes(standardEocdSig)).toBe(true);
  }, 15000);
});
