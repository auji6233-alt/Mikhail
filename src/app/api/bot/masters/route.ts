import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkApiKey } from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

// GET /api/bot/masters?serviceId=... — мастера (для бота, требует X-API-Key).
export async function GET(req: NextRequest) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  const serviceId = req.nextUrl.searchParams.get("serviceId");
  const masters = await prisma.master.findMany({
    where: {
      isActive: true,
      ...(serviceId ? { services: { some: { serviceId } } } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, specialty: true },
  });
  return NextResponse.json(masters);
}
