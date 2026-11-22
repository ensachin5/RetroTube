const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

const MAX_BASE_LENGTH = 120;

export function sanitizeFilenameSegment(raw: string): string {
  // Remove control chars, path separators, reserved filesystem symbols
  let cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Strip leading/trailing dots and spaces (Windows compatibility)
  cleaned = cleaned.replace(/^[.\s]+|[.\s]+$/g, "");

  if (!cleaned) {
    return "retrotube-video";
  }

  if (WINDOWS_RESERVED_NAMES.has(cleaned.toUpperCase())) {
    cleaned = `_${cleaned}`;
  }

  if (cleaned.length > MAX_BASE_LENGTH) {
    cleaned = cleaned.slice(0, MAX_BASE_LENGTH).replace(/[.\s]+$/g, "");
  }

  return cleaned || "retrotube-video";
}

export function sanitizeExtension(ext: string): string {
  const cleaned = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  return cleaned || "bin";
}

export function buildSafeOutputFilename(params: {
  title: string;
  qualityTag?: string | null;
  extension: string;
}): string {
  const base = sanitizeFilenameSegment(params.title);
  const ext = sanitizeExtension(params.extension);
  const tag = params.qualityTag ? sanitizeFilenameSegment(params.qualityTag) : null;

  return tag ? `${base} [${tag}].${ext}` : `${base}.${ext}`;
}

export function buildNumberedBatchFilename(params: {
  position: number;
  title: string;
  extension: string;
}): string {
  const pad = String(params.position).padStart(3, "0");
  const base = sanitizeFilenameSegment(params.title);
  const ext = sanitizeExtension(params.extension);
  return `${pad} - ${base}.${ext}`;
}

function toAsciiFallback(filename: string): string {
  const ascii = filename
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/["\\;]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  if (!ascii || ascii.startsWith(".")) {
    const extMatch = filename.match(/(\.[a-zA-Z0-9]{1,10})$/);
    return `retrotube-download${extMatch?.[1] ?? ""}`;
  }

  return ascii;
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*!]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function buildContentDisposition(filename: string): string {
  const asciiName = toAsciiFallback(filename);
  const encodedName = encodeRfc5987(filename);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}
