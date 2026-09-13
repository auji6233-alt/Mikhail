import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/apiErrors";

export const dynamic = "force-dynamic";

// GET /api/services — список активных услуг.
export async function GET() {
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
