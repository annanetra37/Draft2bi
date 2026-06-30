import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashContent, parseDataUrl, saveImage } from "@/lib/storage";
import { processSourceImage } from "@/lib/pipeline";
import { demoPageDataUrl } from "@/lib/demoPage";

export const dynamic = "force-dynamic";

// Layer [1]+[2]: accept one or many pages, dedup by content hash, store, and
// kick off extraction. `process: true` (default) runs extraction inline so the
// demo is synchronous; in production this would enqueue a background job.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const runProcess = body.process !== false;

  // Normalize input into a list of {dataUrl, docType, note}.
  let items: { dataUrl: string; docType?: string; note?: string }[] = [];
  if (Array.isArray(body.images)) {
    items = body.images;
  } else if (body.demo) {
    const docType = body.docType || "product_list";
    items = [{ dataUrl: demoPageDataUrl(docType), docType, note: body.note }];
  } else if (body.dataUrl) {
    items = [{ dataUrl: body.dataUrl, docType: body.docType, note: body.note }];
  } else {
    return NextResponse.json({ error: "no images provided" }, { status: 400 });
  }

  const results = [];
  for (const item of items) {
    const parsed = parseDataUrl(item.dataUrl);
    if (!parsed) {
      results.push({ error: "invalid data URL" });
      continue;
    }
    const hash = hashContent(parsed.buf);

    // Duplicate-page detection (Part C "store & reconcile").
    const dup = await prisma.sourceImage.findFirst({ where: { hash } });
    if (dup) {
      await prisma.sourceImage.update({ where: { id: dup.id }, data: { status: "duplicate" } }).catch(() => {});
      results.push({ id: dup.id, duplicate: true, docType: dup.docType });
      continue;
    }

    // SVG demo pages stay as data URLs (no file write); real photos persist.
    let url: string;
    if (parsed.mediaType.includes("svg")) {
      url = item.dataUrl;
    } else {
      url = await saveImage(parsed.buf, parsed.mediaType, hash);
    }

    const image = await prisma.sourceImage.create({
      data: {
        url,
        hash,
        docType: item.docType || "unknown",
        note: item.note,
        status: "uploaded",
      },
    });

    if (runProcess) {
      try {
        const summary = await processSourceImage(image.id);
        results.push({ id: image.id, ...summary });
      } catch (e: any) {
        await prisma.sourceImage.update({ where: { id: image.id }, data: { status: "failed" } });
        results.push({ id: image.id, error: e?.message ?? "extraction failed" });
      }
    } else {
      results.push({ id: image.id, status: "uploaded" });
    }
  }

  return NextResponse.json({ results });
}
