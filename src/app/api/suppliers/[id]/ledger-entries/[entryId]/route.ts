import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/api-auth";
import {
  updateSupplierLedgerEntry,
  deleteSupplierLedgerEntry,
} from "@/lib/supplier-ledger";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { error } = await requirePermission("suppliers:write");
  if (error) return error;

  const { entryId } = await params;
  const body = await request.json();
  const { amount, description } = body;

  const newAmount = Number(amount);
  if (!newAmount || newAmount <= 0) {
    return NextResponse.json(
      { error: "Geçerli bir işlem tutarı girin" },
      { status: 400 }
    );
  }

  try {
    const updated = await updateSupplierLedgerEntry(
      entryId,
      newAmount,
      description
    );
    return NextResponse.json({ success: true, entry: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "İşlem güncellenemedi";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { error } = await requirePermission("suppliers:write");
  if (error) return error;

  const { entryId } = await params;

  try {
    await deleteSupplierLedgerEntry(entryId);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "İşlem silinemedi";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
