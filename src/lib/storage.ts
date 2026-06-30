import { createHash } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

// Storage abstraction (layer [2]). Dev writes to /public/uploads and returns a
// site-relative URL; production would swap this for Cloudinary/S3 and return the
// remote URL. The content hash powers duplicate-page detection.

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

export function hashContent(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 32);
}

export function parseDataUrl(dataUrl: string): { buf: Buffer; mediaType: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
  if (!m) return null;
  return { mediaType: m[1], buf: Buffer.from(m[2], "base64") };
}

export async function saveImage(buf: Buffer, mediaType: string, hash: string): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const ext = mediaType.includes("png") ? "png" : mediaType.includes("webp") ? "webp" : "jpg";
  const filename = `${hash}.${ext}`;
  await writeFile(path.join(UPLOAD_DIR, filename), buf);
  return `/uploads/${filename}`;
}
