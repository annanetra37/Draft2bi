import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Supports the review screen's product picker and the dashboard filter bar.
export async function GET() {
  const [variants, products, sellingPoints, counts] = await Promise.all([
    prisma.variant.findMany({ include: { product: true }, orderBy: { label: "asc" } }),
    prisma.product.findMany({ orderBy: { name: "asc" } }),
    prisma.sellingPoint.findMany({ orderBy: { name: "asc" } }),
    prisma.sourceImage.groupBy({ by: ["status"], _count: true }),
  ]);

  return NextResponse.json({
    variants: variants.map((v) => ({ id: v.id, label: v.label, product: v.product.name, sellPrice: v.sellPrice, unit: v.unit })),
    products: products.map((p) => ({ id: p.id, name: p.name, category: p.category })),
    sellingPoints: sellingPoints.map((s) => ({ id: s.id, name: s.name })),
    imageStatus: Object.fromEntries(counts.map((c) => [c.status, c._count])),
  });
}
