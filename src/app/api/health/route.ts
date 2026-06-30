import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Lightweight liveness + DB-connectivity probe for Railway's healthcheck.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "up" });
  } catch (e: any) {
    return NextResponse.json({ status: "degraded", db: "down", error: e?.message }, { status: 503 });
  }
}
