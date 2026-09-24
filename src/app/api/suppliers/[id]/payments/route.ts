import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { recordSupplierTransaction } from "@/lib/supplier-ledger";
import { domainLabels } from "@/lib/domain";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requirePermission("suppliers:write");
  if (error) return error;

  const { id } = await params;
  const body = await request.json();
  const { amount, description, type } = body;

  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) {
    return NextResponse.json({ error: `${domainLabels.supplier.one} bulunamadı` }, { status: 404 });
  }

  const transactionAmount = Number(amount);
  if (!transactionAmount || transactionAmount <= 0) {
    return NextResponse.json({ error: "Geçerli bir tutar girin" }, { status: 400 });
  }

  const transactionType: "ODEME" | "HIZMET" = type === "HIZMET" ? "HIZMET" : "ODEME";
  await recordSupplierTransaction(id, transactionType, transactionAmount, description);

  const updated = await prisma.supplier.findUnique({
    where: { id },
    include: {
      ledgerEntries: {
        include: {
          workOrder: {
            select: { id: true, ticketNo: true, title: true, status: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return NextResponse.json(updated);
}
