import fs from "node:fs";
import fsp from "node:fs/promises";
import zlib from "node:zlib";
import { buildNumberedBatchFilename } from "@/lib/filename";
import { logger } from "@/lib/logger";

export interface ZipItemDescriptor {
  position: number;
  title: string;
  extension: string;
  tempFilepath: string;
}

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

export function crc32(buf: Buffer | Uint8Array, prev = 0): number {
  if (typeof zlib.crc32 === "function") {
    return zlib.crc32(buf, prev);
  }
  let c = (prev ^ -1) >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c = (CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ -1) >>> 0;
}

const ZIP64_THRESHOLD = 0xffffffffn; // 4,294,967,295 bytes (4 GB - 1 byte)

interface CentralDirectoryEntry {
  nameBuf: Buffer;
  crc: number;
  uncompressedSize: bigint;
  compressedSize: bigint;
  localHeaderOffset: bigint;
  isZip64: boolean;
}

export const zipService = {
  createStreamingZip(
    items: ZipItemDescriptor[],
    requestId?: string,
  ): ReadableStream<Uint8Array> {
    const usedFilenames = new Set<string>();
    let activeFileStream: fs.ReadStream | null = null;

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        let totalWritten = 0n;
        const cdEntries: CentralDirectoryEntry[] = [];
        let anyZip64 = false;

        try {
          for (const item of items) {
            if (!fs.existsSync(item.tempFilepath)) {
              logger.warn("Skipping missing temp file during ZIP generation", {
                requestId,
                filepath: item.tempFilepath,
                title: item.title,
              });
              continue;
            }

            let stat: fs.Stats;
            try {
              stat = await fsp.stat(item.tempFilepath);
            } catch {
              continue;
            }

            const fileSize = BigInt(stat.size);
            const isEntryZip64 =
              fileSize >= ZIP64_THRESHOLD || totalWritten >= ZIP64_THRESHOLD;
            if (isEntryZip64) {
              anyZip64 = true;
            }

            let filename = buildNumberedBatchFilename({
              position: item.position,
              title: item.title,
              extension: item.extension,
            });

            if (usedFilenames.has(filename)) {
              let duplicateIdx = 2;
              let altName = `${filename.replace(
                /\.[^.]+$/,
                "",
              )} (${duplicateIdx}).${item.extension}`;
              while (usedFilenames.has(altName)) {
                duplicateIdx++;
                altName = `${filename.replace(
                  /\.[^.]+$/,
                  "",
                )} (${duplicateIdx}).${item.extension}`;
              }
              filename = altName;
            }
            usedFilenames.add(filename);

            const nameBuf = Buffer.from(filename, "utf8");
            const localHeaderOffset = totalWritten;

            // Build Local File Header
            let localHeader: Buffer;
            if (isEntryZip64) {
              const extraBuf = Buffer.alloc(20);
              extraBuf.writeUInt16LE(0x0001, 0); // ZIP64 tag
              extraBuf.writeUInt16LE(16, 2); // extra size (uncomp + comp)
              extraBuf.writeBigUInt64LE(fileSize, 4);
              extraBuf.writeBigUInt64LE(fileSize, 12);

              localHeader = Buffer.alloc(30 + nameBuf.length + extraBuf.length);
              localHeader.writeUInt32LE(0x04034b50, 0); // Signature
              localHeader.writeUInt16LE(45, 4); // v4.5 for ZIP64
              localHeader.writeUInt16LE(0x0808, 6); // Bit 3 (data descriptor) + UTF-8
              localHeader.writeUInt16LE(0, 8); // STORE mode (no compression)
              localHeader.writeUInt32LE(0, 10); // DOS Time/Date
              localHeader.writeUInt32LE(0, 14); // CRC in data descriptor
              localHeader.writeUInt32LE(0xffffffff, 18);
              localHeader.writeUInt32LE(0xffffffff, 22);
              localHeader.writeUInt16LE(nameBuf.length, 26);
              localHeader.writeUInt16LE(extraBuf.length, 28);
              nameBuf.copy(localHeader, 30);
              extraBuf.copy(localHeader, 30 + nameBuf.length);
            } else {
              localHeader = Buffer.alloc(30 + nameBuf.length);
              localHeader.writeUInt32LE(0x04034b50, 0);
              localHeader.writeUInt16LE(20, 4); // v2.0
              localHeader.writeUInt16LE(0x0808, 6);
              localHeader.writeUInt16LE(0, 8); // STORE mode
              localHeader.writeUInt32LE(0, 10);
              localHeader.writeUInt32LE(0, 14);
              localHeader.writeUInt32LE(0, 18);
              localHeader.writeUInt32LE(0, 22);
              localHeader.writeUInt16LE(nameBuf.length, 26);
              localHeader.writeUInt16LE(0, 28);
              nameBuf.copy(localHeader, 30);
            }

            controller.enqueue(new Uint8Array(localHeader));
            totalWritten += BigInt(localHeader.length);

            // Stream file contents & compute CRC32
            let runningCrc = 0;
            let bytesStreamed = 0n;

            await new Promise<void>((resolve, reject) => {
              const fileStream = fs.createReadStream(item.tempFilepath, {
                highWaterMark: 512 * 1024,
              });
              activeFileStream = fileStream;

              fileStream.on("data", (chunk: Buffer | string | Uint8Array) => {
                const u8 =
                  typeof chunk === "string"
                    ? Buffer.from(chunk)
                    : chunk instanceof Uint8Array
                      ? chunk
                      : new Uint8Array(chunk);

                runningCrc = crc32(u8, runningCrc);
                bytesStreamed += BigInt(u8.length);

                controller.enqueue(u8);
                if (
                  controller.desiredSize !== null &&
                  controller.desiredSize <= 0
                ) {
                  fileStream.pause();
                }
              });

              fileStream.on("end", () => {
                activeFileStream = null;
                resolve();
              });

              fileStream.on("error", (err) => {
                activeFileStream = null;
                reject(err);
              });
            });

            totalWritten += bytesStreamed;

            // Emit Data Descriptor
            let dataDescriptor: Buffer;
            if (isEntryZip64) {
              dataDescriptor = Buffer.alloc(24);
              dataDescriptor.writeUInt32LE(0x08074b50, 0);
              dataDescriptor.writeUInt32LE(runningCrc, 4);
              dataDescriptor.writeBigUInt64LE(bytesStreamed, 8);
              dataDescriptor.writeBigUInt64LE(bytesStreamed, 16);
            } else {
              dataDescriptor = Buffer.alloc(16);
              dataDescriptor.writeUInt32LE(0x08074b50, 0);
              dataDescriptor.writeUInt32LE(runningCrc, 4);
              dataDescriptor.writeUInt32LE(Number(bytesStreamed), 8);
              dataDescriptor.writeUInt32LE(Number(bytesStreamed), 12);
            }

            controller.enqueue(new Uint8Array(dataDescriptor));
            totalWritten += BigInt(dataDescriptor.length);

            cdEntries.push({
              nameBuf,
              crc: runningCrc,
              uncompressedSize: bytesStreamed,
              compressedSize: bytesStreamed,
              localHeaderOffset,
              isZip64: isEntryZip64,
            });
          }

          // Emit Central Directory Headers
          const cdStart = totalWritten;
          let cdSize = 0n;

          for (const cd of cdEntries) {
            const needsZip64 =
              cd.isZip64 ||
              cd.uncompressedSize >= ZIP64_THRESHOLD ||
              cd.localHeaderOffset >= ZIP64_THRESHOLD;

            let cdh: Buffer;
            if (needsZip64) {
              const extraParts: Buffer[] = [];
              if (
                cd.uncompressedSize >= ZIP64_THRESHOLD ||
                cd.compressedSize >= ZIP64_THRESHOLD
              ) {
                const sizeBuf = Buffer.alloc(16);
                sizeBuf.writeBigUInt64LE(cd.uncompressedSize, 0);
                sizeBuf.writeBigUInt64LE(cd.compressedSize, 8);
                extraParts.push(sizeBuf);
              }
              if (cd.localHeaderOffset >= ZIP64_THRESHOLD) {
                const offsetBuf = Buffer.alloc(8);
                offsetBuf.writeBigUInt64LE(cd.localHeaderOffset, 0);
                extraParts.push(offsetBuf);
              }

              // Extra header: tag (2) + size (2) + data
              const extraData = Buffer.concat(extraParts);
              const extraHeader = Buffer.alloc(4);
              extraHeader.writeUInt16LE(0x0001, 0);
              extraHeader.writeUInt16LE(extraData.length, 2);
              const fullExtra = Buffer.concat([extraHeader, extraData]);

              cdh = Buffer.alloc(46 + cd.nameBuf.length + fullExtra.length);
              cdh.writeUInt32LE(0x02014b50, 0);
              cdh.writeUInt16LE(45, 4); // v4.5
              cdh.writeUInt16LE(45, 6);
              cdh.writeUInt16LE(0x0808, 8);
              cdh.writeUInt16LE(0, 10);
              cdh.writeUInt32LE(0, 12);
              cdh.writeUInt32LE(cd.crc, 16);
              cdh.writeUInt32LE(
                cd.compressedSize >= ZIP64_THRESHOLD
                  ? 0xffffffff
                  : Number(cd.compressedSize),
                20,
              );
              cdh.writeUInt32LE(
                cd.uncompressedSize >= ZIP64_THRESHOLD
                  ? 0xffffffff
                  : Number(cd.uncompressedSize),
                24,
              );
              cdh.writeUInt16LE(cd.nameBuf.length, 28);
              cdh.writeUInt16LE(fullExtra.length, 30);
              cdh.writeUInt16LE(0, 32);
              cdh.writeUInt16LE(0, 34);
              cdh.writeUInt16LE(0, 36);
              cdh.writeUInt32LE(0, 38);
              cdh.writeUInt32LE(
                cd.localHeaderOffset >= ZIP64_THRESHOLD
                  ? 0xffffffff
                  : Number(cd.localHeaderOffset),
                42,
              );
              cd.nameBuf.copy(cdh, 46);
              fullExtra.copy(cdh, 46 + cd.nameBuf.length);
            } else {
              cdh = Buffer.alloc(46 + cd.nameBuf.length);
              cdh.writeUInt32LE(0x02014b50, 0);
              cdh.writeUInt16LE(20, 4);
              cdh.writeUInt16LE(20, 6);
              cdh.writeUInt16LE(0x0808, 8);
              cdh.writeUInt16LE(0, 10);
              cdh.writeUInt32LE(0, 12);
              cdh.writeUInt32LE(cd.crc, 16);
              cdh.writeUInt32LE(Number(cd.compressedSize), 20);
              cdh.writeUInt32LE(Number(cd.uncompressedSize), 24);
              cdh.writeUInt16LE(cd.nameBuf.length, 28);
              cdh.writeUInt16LE(0, 30);
              cdh.writeUInt16LE(0, 32);
              cdh.writeUInt16LE(0, 34);
              cdh.writeUInt16LE(0, 36);
              cdh.writeUInt32LE(0, 38);
              cdh.writeUInt32LE(Number(cd.localHeaderOffset), 42);
              cd.nameBuf.copy(cdh, 46);
            }

            controller.enqueue(new Uint8Array(cdh));
            totalWritten += BigInt(cdh.length);
            cdSize += BigInt(cdh.length);
          }

          const isArchiveZip64 =
            anyZip64 ||
            totalWritten >= ZIP64_THRESHOLD ||
            cdStart >= ZIP64_THRESHOLD ||
            cdEntries.length >= 0xffff;

          if (isArchiveZip64) {
            // ZIP64 End of Central Directory Record (56 bytes)
            const z64Eocd = Buffer.alloc(56);
            z64Eocd.writeUInt32LE(0x06064b50, 0);
            z64Eocd.writeBigUInt64LE(44n, 4); // remaining record size
            z64Eocd.writeUInt16LE(45, 12);
            z64Eocd.writeUInt16LE(45, 14);
            z64Eocd.writeUInt32LE(0, 16);
            z64Eocd.writeUInt32LE(0, 20);
            z64Eocd.writeBigUInt64LE(BigInt(cdEntries.length), 24);
            z64Eocd.writeBigUInt64LE(BigInt(cdEntries.length), 32);
            z64Eocd.writeBigUInt64LE(cdSize, 40);
            z64Eocd.writeBigUInt64LE(cdStart, 48);

            controller.enqueue(new Uint8Array(z64Eocd));
            const z64EocdOffset = totalWritten;
            totalWritten += BigInt(z64Eocd.length);

            // ZIP64 End of Central Directory Locator (20 bytes)
            const z64Loc = Buffer.alloc(20);
            z64Loc.writeUInt32LE(0x07064b50, 0);
            z64Loc.writeUInt32LE(0, 4);
            z64Loc.writeBigUInt64LE(z64EocdOffset, 8);
            z64Loc.writeUInt32LE(1, 16);

            controller.enqueue(new Uint8Array(z64Loc));
            totalWritten += BigInt(z64Loc.length);

            // Standard EOCD with 0xFFFF/0xFFFFFFFF sentinels (22 bytes)
            const eocd = Buffer.alloc(22);
            eocd.writeUInt32LE(0x06054b50, 0);
            eocd.writeUInt16LE(0, 4);
            eocd.writeUInt16LE(0, 6);
            eocd.writeUInt16LE(0xffff, 8);
            eocd.writeUInt16LE(0xffff, 10);
            eocd.writeUInt32LE(0xffffffff, 12);
            eocd.writeUInt32LE(0xffffffff, 16);
            eocd.writeUInt16LE(0, 20);

            controller.enqueue(new Uint8Array(eocd));
          } else {
            // Standard EOCD (22 bytes)
            const eocd = Buffer.alloc(22);
            eocd.writeUInt32LE(0x06054b50, 0);
            eocd.writeUInt16LE(0, 4);
            eocd.writeUInt16LE(0, 6);
            eocd.writeUInt16LE(cdEntries.length, 8);
            eocd.writeUInt16LE(cdEntries.length, 10);
            eocd.writeUInt32LE(Number(cdSize), 12);
            eocd.writeUInt32LE(Number(cdStart), 16);
            eocd.writeUInt16LE(0, 20);

            controller.enqueue(new Uint8Array(eocd));
          }

          controller.close();
        } catch (streamErr) {
          logger.error("Error during ZIP file reading", {
            requestId,
            error: streamErr,
          });
          controller.error(streamErr);
        }
      },
      pull() {
        if (activeFileStream && activeFileStream.isPaused()) {
          activeFileStream.resume();
        }
      },
      cancel() {
        if (activeFileStream && !activeFileStream.destroyed) {
          activeFileStream.destroy();
        }
      },
    });
  },
};
