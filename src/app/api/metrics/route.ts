import { NextRequest, NextResponse } from "next/server";
import { getMetrics } from "@/lib/metrics/engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const metrics = await getMetrics({
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    sellingPointId: sp.get("sellingPointId") ?? undefined,
    productId: sp.get("productId") ?? undefined,
    category: sp.get("category") ?? undefined,
  });
  return NextResponse.json(metrics);
}
