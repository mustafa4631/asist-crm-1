import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { authenticate, requirePermission } from "../lib/session.js";
import { logActivity } from "../lib/activity-log.js";
import { paramString } from "../lib/params.js";
import { openWorkOrderFilter, completedWorkOrderListFilter, workOrderStatusFlow } from "@asistcrm/lib/work-order-status";
import { resolveResponsibleId } from "../lib/responsibles.js";
import { resolveJobTypeCode } from "@asistcrm/lib/job-types";
import { syncRepairItems, type RepairItemInput } from "@asistcrm/lib/repair-items";
import { syncSupplierLedger } from "@asistcrm/lib/supplier-ledger";
import { formatTicketNo, getNextTicketNo } from "@asistcrm/lib/domain";

export const workOrdersRouter = Router();

workOrdersRouter.use(authenticate);

workOrdersRouter.get("/", requirePermission("orders:read"), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const tab = typeof req.query.tab === "string" ? req.query.tab : undefined;

  let where: Record<string, unknown> = {};
  if (tab === "open") where = openWorkOrderFilter;
  else if (tab === "completed") where = completedWorkOrderListFilter;
  if (status) where = { ...where, status };

  const orders = await prisma.workOrder.findMany({
    where: Object.keys(where).length ? where : undefined,
    include: {
      insuranceCompany: true,
      assignedTo: { select: { id: true, name: true } },
    },
    orderBy: [{ priority: "desc" }, { reportedAt: "desc" }],
  });

  res.json(orders);
});

workOrdersRouter.post("/", requirePermission("orders:write"), async (req, res) => {
  const body = req.body ?? {};
  const {
    title,
    asistansDosyaNo,
    insuredFirstName,
    insuredLastName,
    insuredPhone,
    insuredAddress,
    insuredCity,
    insuredDistrict,
    description,
    insuranceCompanyId,
    priority,
    assignedToId,
    notes,
    jobType,
    operatorNote,
  } = body;

  const dosyaNo = typeof title === "string" ? title.trim() : "";
  const assistanceNo = typeof asistansDosyaNo === "string" ? asistansDosyaNo.trim() : "";

  if (!dosyaNo && !assistanceNo) {
    res.status(400).json({ error: "Dosya No ve Asistans Dosya No zorunludur." });
    return;
  }
  if (!dosyaNo) {
    res.status(400).json({ error: "Dosya No zorunludur." });
    return;
  }
  if (!assistanceNo) {
    res.status(400).json({ error: "Asistans Dosya No zorunludur." });
    return;
  }
  if (!insuranceCompanyId || !jobType) {
    res.status(400).json({ error: "Sigorta şirketi ve hizmet türü zorunludur" });
    return;
  }

  if (!insuredFirstName?.trim() || !insuredLastName?.trim() || !insuredPhone?.trim()) {
    res.status(400).json({ error: "Sigortalı adı, soyadı ve telefonu zorunludur" });
    return;
  }

  if (!assignedToId?.trim()) {
    res.status(400).json({ error: "Koordinatör seçimi zorunludur" });
    return;
  }

  const resolved = await resolveResponsibleId(assignedToId);
  if ("error" in resolved) {
    res.status(400).json({ error: resolved.error });
    return;
  }

  const resolvedJobType = await resolveJobTypeCode(prisma, String(jobType));
  if ("error" in resolvedJobType) {
    res.status(400).json({ error: resolvedJobType.error });
    return;
  }

  let order: any = null;
  const MAX_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const ticketNo = await getNextTicketNo(prisma);

    try {
      order = await prisma.workOrder.create({
        data: {
          ticketNo,
          title: dosyaNo,
          asistansDosyaNo: assistanceNo,
          insuredFirstName: String(insuredFirstName).trim(),
          insuredLastName: String(insuredLastName).trim(),
          insuredPhone: String(insuredPhone).trim(),
          insuredAddress: typeof insuredAddress === "string" ? insuredAddress.trim() || null : null,
          insuredCity: typeof insuredCity === "string" ? insuredCity.trim() || null : null,
          insuredDistrict: typeof insuredDistrict === "string" ? insuredDistrict.trim() || null : null,
          description,
          jobType: resolvedJobType.code,
          insuranceCompanyId,
          priority: priority ?? "NORMAL",
          assignedToId: resolved.id,
          notes,
          ...(typeof operatorNote === "string" && operatorNote.trim()
            ? {
                operatorNotes: {
                  create: { content: operatorNote.trim(), authorId: req.user!.id },
                },
              }
            : {}),
        },
        include: {
          insuranceCompany: true,
          assignedTo: { select: { id: true, name: true } },
        },
      });
      break;
    } catch (err: any) {
      if (err && typeof err === "object" && err.code === "P2002") {
        if (attempt === MAX_ATTEMPTS - 1) {
          res.status(409).json({ error: "Sistem kayıt numarası çakıştı, lütfen tekrar deneyin." });
          return;
        }
        continue;
      }
      throw err;
    }
  }

  if (!order) {
    res.status(500).json({ error: "Kayıt oluşturulamadı." });
    return;
  }

  logActivity({
    userId: req.user!.id,
    action: "create",
    entityType: "work_order",
    entityId: order.id,
    entityLabel: order.ticketNo,
    details: order.title,
  });

  res.status(201).json(order);
});

workOrdersRouter.get("/:id/operator-notes", requirePermission("orders:read"), async (req, res) => {
  const workOrderId = paramString(req.params.id);
  const order = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true },
  });
  if (!order) {
    res.status(404).json({ error: "Kayıt bulunamadı" });
    return;
  }

  const notes = await prisma.workOrderOperatorNote.findMany({
    where: { workOrderId },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  res.json(
    notes.map((note) => ({
      id: note.id,
      content: note.content,
      createdAt: note.createdAt.toISOString(),
      author: note.author,
    }))
  );
});

workOrdersRouter.post("/:id/operator-notes", requirePermission("orders:write"), async (req, res) => {
  const workOrderId = paramString(req.params.id);
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!content) {
    res.status(400).json({ error: "Not metni boş olamaz" });
    return;
  }

  const order = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true },
  });
  if (!order) {
    res.status(404).json({ error: "Kayıt bulunamadı" });
    return;
  }

  const note = await prisma.workOrderOperatorNote.create({
    data: {
      workOrderId,
      authorId: req.user!.id,
      content,
    },
    include: { author: { select: { id: true, name: true } } },
  });

  res.status(201).json({
    id: note.id,
    content: note.content,
    createdAt: note.createdAt.toISOString(),
    author: note.author,
  });
});

workOrdersRouter.patch("/:id", requirePermission("orders:write"), async (req, res) => {
  const id = paramString(req.params.id);
  const body = req.body ?? {};
  const {
    title,
    description,
    status,
    priority,
    assignedToId,
    notes,
    jobType,
    invoiceAmount,
    supplierCost,
    supplierId,
    repairItems,
  } = body;

  const existing = await prisma.workOrder.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Kayıt bulunamadı" });
    return;
  }

  const data: Record<string, unknown> = {};
  if (title) data.title = title;
  if (description !== undefined) data.description = description;
  if (status) {
    if (!workOrderStatusFlow.includes(status as (typeof workOrderStatusFlow)[number])) {
      res.status(400).json({ error: "Geçersiz durum" });
      return;
    }
    data.status = status;
    if (status === "TAMAMLANDI" || status === "SERVIS_BEDELI_ILE_TAMAMLANDI") {
      data.completedAt = existing.completedAt ?? new Date();
    } else {
      data.completedAt = null;
    }
  }
  if (priority) data.priority = priority;
  if (assignedToId !== undefined) {
    const resolved = await resolveResponsibleId(assignedToId);
    if ("error" in resolved) {
      res.status(400).json({ error: resolved.error });
      return;
    }
    data.assignedToId = resolved.id;
  }
  if (notes !== undefined) data.notes = notes;
  if (jobType !== undefined) {
    const resolvedJobType = await resolveJobTypeCode(prisma, String(jobType));
    if ("error" in resolvedJobType) {
      res.status(400).json({ error: resolvedJobType.error });
      return;
    }
    data.jobType = resolvedJobType.code;
  }
  if (invoiceAmount !== undefined && repairItems === undefined) {
    data.invoiceAmount = Number(invoiceAmount) || 0;
  }
  if (supplierCost !== undefined) data.supplierCost = Number(supplierCost) || 0;
  if (supplierId !== undefined) data.supplierId = supplierId || null;

  if (repairItems !== undefined) {
    await syncRepairItems(id, repairItems as RepairItemInput[]);
  }

  const newSupplierId = supplierId !== undefined ? supplierId || null : existing.supplierId;
  const newCost = supplierCost !== undefined ? Number(supplierCost) || 0 : existing.supplierCost;

  if (supplierId !== undefined || supplierCost !== undefined) {
    await syncSupplierLedger(id, existing.ticketNo, newSupplierId, newCost);
  }

  const order = await prisma.workOrder.update({
    where: { id },
    data,
    include: {
      insuranceCompany: true,
      assignedTo: { select: { id: true, name: true } },
      supplier: { select: { id: true, firstName: true, lastName: true, iban: true, balance: true } },
      repairItems: { orderBy: { sortOrder: "asc" } },
    },
  });

  logActivity({
    userId: req.user!.id,
    action: status && status !== existing.status ? "status_change" : "update",
    entityType: "work_order",
    entityId: order.id,
    entityLabel: order.ticketNo,
    details: status && status !== existing.status ? `Durum: ${status}` : order.title,
  });

  res.json(order);
});

workOrdersRouter.delete("/:id", requirePermission("orders:write"), async (req, res) => {
  const id = paramString(req.params.id);

  const existing = await prisma.workOrder.findUnique({ where: { id } });

  if (existing?.supplierId && existing.supplierCost > 0) {
    await syncSupplierLedger(id, existing.ticketNo, null, 0);
  }

  if (existing) {
    logActivity({
      userId: req.user!.id,
      action: "delete",
      entityType: "work_order",
      entityId: existing.id,
      entityLabel: existing.ticketNo,
    });
  }

  await prisma.workOrder.delete({ where: { id } });
  res.json({ success: true });
});
