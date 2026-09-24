import { prisma } from "@/lib/prisma";
import { domainLabels } from "@/lib/domain";

/** Talep kaydındaki tedarikçi ödemesini cariye borç olarak yansıtır. */
export async function syncSupplierLedger(
  workOrderId: string,
  ticketNo: string,
  newSupplierId: string | null,
  newCost: number
) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.supplierLedgerEntry.findUnique({
      where: { workOrderId },
    });

    if (existing) {
      await tx.supplier.update({
        where: { id: existing.supplierId },
        data: { balance: { decrement: existing.amount } },
      });
      await tx.supplierLedgerEntry.delete({ where: { id: existing.id } });
    }

    if (newSupplierId && newCost > 0) {
      await tx.supplierLedgerEntry.create({
        data: {
          type: "HIZMET",
          supplierId: newSupplierId,
          workOrderId,
          amount: newCost,
          description: `${ticketNo} — talep kaydı hizmet bedeli`,
        },
      });
      await tx.supplier.update({
        where: { id: newSupplierId },
        data: { balance: { increment: newCost } },
      });
    }
  });
}

/** Tedarikçi işlemi ekler (HIZMET veya ODEME) ve bakiyeyi atomik günceller. */
export async function recordSupplierTransaction(
  supplierId: string,
  type: "ODEME" | "HIZMET",
  amount: number,
  description?: string
) {
  if (amount <= 0) throw new Error("İşlem tutarı sıfırdan büyük olmalı");

  return await prisma.$transaction(async (tx) => {
    const entry = await tx.supplierLedgerEntry.create({
      data: {
        type,
        supplierId,
        amount,
        description:
          description?.trim() ||
          (type === "ODEME"
            ? `${domainLabels.supplier.one} ödemesi`
            : `${domainLabels.supplier.one} hizmet bedeli`),
      },
    });

    await tx.supplier.update({
      where: { id: supplierId },
      data: {
        balance:
          type === "HIZMET"
            ? { increment: amount }
            : { decrement: amount },
      },
    });

    return entry;
  });
}

/** Tedarikçiye yapılan ödemeyi cariye işler (bakiyeyi düşürür). Geriye uyumluluk için. */
export async function recordSupplierPayment(
  supplierId: string,
  amount: number,
  description?: string
) {
  return await recordSupplierTransaction(supplierId, "ODEME", amount, description);
}

/** Cari hareketini günceller ve bakiye farkını hesaplayıp tedarikçi bakiyesini revize eder. */
export async function updateSupplierLedgerEntry(
  entryId: string,
  newAmount: number,
  newDescription?: string
) {
  if (newAmount <= 0) throw new Error("İşlem tutarı sıfırdan büyük olmalı");

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.supplierLedgerEntry.findUnique({
      where: { id: entryId },
    });

    if (!existing) {
      throw new Error("Cari hareketi bulunamadı");
    }

    const diff = newAmount - existing.amount;

    const updated = await tx.supplierLedgerEntry.update({
      where: { id: entryId },
      data: {
        amount: newAmount,
        ...(newDescription !== undefined ? { description: newDescription.trim() || null } : {}),
      },
    });

    if (diff !== 0) {
      await tx.supplier.update({
        where: { id: existing.supplierId },
        data: {
          balance:
            existing.type === "ODEME"
              ? { decrement: diff }
              : { increment: diff },
        },
      });
    }

    return updated;
  });
}

/** Cari hareketini siler ve bakiyeyi eski haline getirir. */
export async function deleteSupplierLedgerEntry(entryId: string) {
  return await prisma.$transaction(async (tx) => {
    const existing = await tx.supplierLedgerEntry.findUnique({
      where: { id: entryId },
    });

    if (!existing) {
      throw new Error("Cari hareketi bulunamadı");
    }

    await tx.supplier.update({
      where: { id: existing.supplierId },
      data: {
        balance:
          existing.type === "ODEME"
            ? { increment: existing.amount }
            : { decrement: existing.amount },
      },
    });

    await tx.supplierLedgerEntry.delete({
      where: { id: entryId },
    });

    return { success: true };
  });
}

