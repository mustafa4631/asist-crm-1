import { formatTicketNo, getNextTicketNo, domainLabels } from "@/lib/domain";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/api-auth";
import { logActivity } from "@/lib/activity-log";
import { openWorkOrderFilter, completedWorkOrderListFilter } from "@/lib/work-order-status";
import { resolveResponsibleId } from "@/lib/responsibles";
import { resolveJobTypeCode } from "@/lib/job-types";
import {
  parseWorkOrderNumbers,
  validateRequiredWorkOrderNumbers,
} from "@/lib/work-order-numbers";
import { parseAppointmentAt, syncWorkOrderPlannerEvent } from "@/lib/work-order-planner";

export async function GET(request: Request) {
  const { error } = await requirePermission("orders:read");
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const tab = searchParams.get("tab");

  let where: Record<string, unknown> = {};

  if (tab === "open") {
    where = openWorkOrderFilter;
  } else if (tab === "completed") {
    where = completedWorkOrderListFilter;
  }

  if (status) {
    where = { ...where, status };
  }

  const orders = await prisma.workOrder.findMany({
    where: Object.keys(where).length ? where : undefined,
    include: {
      insuranceCompany: true,
      assignedTo: { select: { id: true, name: true } },
    },
    orderBy: [{ priority: "desc" }, { reportedAt: "desc" }],
  });
  return NextResponse.json(orders);
}

export async function POST(request: Request) {
  const { user, error } = await requirePermission("orders:write");
  if (error) return error;

  const body = await request.json();
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
    appointmentAt,
  } = body;

  const { dosyaNo, asistansDosyaNo: assistanceNo } = parseWorkOrderNumbers({ title, asistansDosyaNo });

  const numberError = validateRequiredWorkOrderNumbers(dosyaNo, assistanceNo);
  if (numberError) {
    return NextResponse.json({ error: numberError }, { status: 400 });
  }

  if (!insuranceCompanyId || !jobType) {
    return NextResponse.json(
      { error: `${domainLabels.insuranceCompany.one} ve hizmet türü zorunludur` },
      { status: 400 }
    );
  }

  if (!insuredFirstName?.trim() || !insuredLastName?.trim() || !insuredPhone?.trim()) {
    return NextResponse.json(
      { error: "Sigortalı adı, soyadı ve telefonu zorunludur" },
      { status: 400 }
    );
  }

  if (!assignedToId?.trim()) {
    return NextResponse.json({ error: "Koordinatör seçimi zorunludur" }, { status: 400 });
  }

  const resolved = await resolveResponsibleId(assignedToId);
  if ("error" in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  const resolvedJobType = await resolveJobTypeCode(prisma, String(jobType));
  if ("error" in resolvedJobType) {
    return NextResponse.json({ error: resolvedJobType.error }, { status: 400 });
  }

  const parsedAppointmentAt = parseAppointmentAt(appointmentAt);

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
          ...(parsedAppointmentAt !== undefined ? { appointmentAt: parsedAppointmentAt } : {}),
          ...(typeof operatorNote === "string" && operatorNote.trim()
            ? {
                operatorNotes: {
                  create: {
                    content: operatorNote.trim(),
                    authorId: user!.id,
                  },
                },
              }
            : {}),
        },
        include: {
          insuranceCompany: true,
          assignedTo: { select: { id: true, name: true } },
          operatorNotes: {
            include: { author: { select: { id: true, name: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      break;
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: string }).code === "P2002"
      ) {
        if (attempt === MAX_ATTEMPTS - 1) {
          return NextResponse.json({ error: "Sistem kayıt numarası çakıştı, lütfen tekrar deneyin." }, { status: 409 });
        }
        continue;
      }
      throw err;
    }
  }

  if (!order) {
    return NextResponse.json({ error: "Kayıt oluşturulamadı." }, { status: 500 });
  }

  await syncWorkOrderPlannerEvent(prisma, order.id);

  logActivity({
    userId: user!.id,
    action: "create",
    entityType: "work_order",
    entityId: order.id,
    entityLabel: order.ticketNo,
    details: order.title,
  });

  return NextResponse.json(order, { status: 201 });
}
