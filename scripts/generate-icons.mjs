import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const SVG_PATH = path.join(ROOT, "scripts/logo.svg");
const ICONS_DIR = path.join(ROOT, "public/icons");
const APPLE_TOUCH_PATH = path.join(ROOT, "public/apple-touch-icon.png");
const FAVICON_PATH = path.join(ROOT, "app/favicon.ico");

function buildSinglePngIco(pngBuffer, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type: 1 = ICO
  header.writeUInt16LE(1, 4); // Image count: 1

  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // Width
  entry.writeUInt8(size >= 256 ? 0 : size, 1); // Height
  entry.writeUInt8(0, 2); // Palette
  entry.writeUInt8(0, 3); // Reserved
  entry.writeUInt16LE(1, 4); // Color planes
  entry.writeUInt16LE(32, 6); // Bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8); // Image size
  entry.writeUInt32LE(6 + 16, 12); // Data offset

  return Buffer.concat([header, entry, pngBuffer]);
}

async function main() {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  const svgBuffer = fs.readFileSync(SVG_PATH);

  // Standard icons (192x192 & 512x512)
  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile(path.join(ICONS_DIR, "icon-192.png"));
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(ICONS_DIR, "icon-512.png"));

  // Maskable 512x512: full-bleed warm cream canvas with centered logo inside 74% safe zone
  const maskableInner = await sharp(svgBuffer).resize(380, 380).png().toBuffer();
  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 246, g: 240, b: 228, alpha: 1 },
    },
  })
    .composite([{ input: maskableInner, gravity: "center" }])
    .png()
    .toFile(path.join(ICONS_DIR, "icon-maskable-512.png"));

  // Apple touch icon (180x180, opaque cream background)
  const appleInner = await sharp(svgBuffer).resize(168, 168).png().toBuffer();
  await sharp({
    create: {
      width: 180,
      height: 180,
      channels: 4,
      background: { r: 246, g: 240, b: 228, alpha: 1 },
    },
  })
    .composite([{ input: appleInner, gravity: "center" }])
    .png()
    .toFile(APPLE_TOUCH_PATH);

  // Favicon (32x32 PNG embedded inside ICO)
  const faviconPng = await sharp(svgBuffer).resize(32, 32).png().toBuffer();
  fs.writeFileSync(FAVICON_PATH, buildSinglePngIco(faviconPng, 32));

  console.log("Generated RetroTube PWA icons and favicon.ico cleanly.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
