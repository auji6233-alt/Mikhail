import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkApiKey } from "@/lib/apiAuth";
import { handleApiError } from "@/lib/apiErrors";

export const dynamic = "force-dynamic";

// GET /api/bot/services — список активных услуг (для бота, требует X-API-Key).
export async function GET(req: NextRequest) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  try {
    const services = await prisma.service.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, priceRub: true, durationMin: true },
    });
    return NextResponse.json(services);
  } catch (err) {
    return handleApiError(err);
  }
}
