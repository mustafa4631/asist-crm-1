"use client";
import { apiFetch } from "@/lib/api-client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Trash2,
  ImagePlus,
  FileDown,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/button";
import { Input, Select, Textarea } from "@/components/form-fields";
import { CurrencyInput } from "@/components/currency-input";
import { Badge } from "@/components/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  InsuranceCompanyLocationSummary,
} from "@/components/insurance-company-contact-summary";
import {
  workOrderStatusLabels,
  workOrderStatusColors,
  priorityLabels,
  priorityColors,
} from "@/lib/permissions";
import {
  formatCurrency,
  formatCurrencyInput,
  formatDateTime,
  parseCurrencyInput,
  cn,
} from "@/lib/utils";
import { SupplierPicker, type SupplierOption } from "@/components/supplier-picker";
import { InsuranceCompanyPicker, type InsuranceCompanyOption } from "@/components/insurance-company-picker";
import { ProvinceDistrictPicker } from "@/components/province-district-picker";
import { companyLocationLine } from "@/lib/insurance-company";
import { OperatorNotesChat } from "@/components/operator-notes-chat";
import { responsibleSelectOptions, type ResponsibleOption } from "@/lib/responsibles";
import {
  getEffectiveRepairItems,
  type WorkOrderDetailData,
  type WorkOrderRepairItem,
  type WorkOrderRepairImage,
} from "../work-order-detail-utils";
import { domainLabels } from "@/lib/domain";
import { workOrderStatusFlow, isWorkOrderClosed } from "@/lib/work-order-status";
import {
  buildSupplierJobWhatsAppMessage,
  validateSupplierWhatsAppSend,
} from "@/lib/whatsapp-supplier-job";

interface RepairItemDraft {
  key: string;
  description: string;
  amount: string;
}

function newDraft(item?: { description: string; amount: number }): RepairItemDraft {
  return {
    key: crypto.randomUUID(),
    description: item?.description ?? "",
    amount: item?.amount ? formatCurrencyInput(item.amount) : "",
  };
}

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-0.5 text-sm text-zinc-800">{value || "—"}</p>
    </div>
  );
}

const PRIORITY_OPTIONS = [
  { value: "DUSUK", label: "Düşük" },
  { value: "NORMAL", label: "Normal" },
  { value: "YUKSEK", label: "Yüksek" },
  { value: "ACIL", label: "Acil" },
];

function toDatetimeLocalValue(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function WorkOrderDetailPanel({
  order,
  insuranceCompanies,
  suppliers,
  responsibles,
  jobTypeOptions,
  jobTypeLabel,
  canWrite,
}: {
  order: WorkOrderDetailData;
  insuranceCompanies: InsuranceCompanyOption[];
  suppliers: SupplierOption[];
  responsibles: ResponsibleOption[];
  jobTypeOptions: { value: string; label: string }[];
  jobTypeLabel: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const backHref =
    searchParams.get("tab") === "completed" ? "/work-orders?tab=completed" : "/work-orders";

  const [jobType, setJobType] = useState(order.jobType);
  const [jobTypeUpdating, setJobTypeUpdating] = useState(false);
  const [title, setTitle] = useState(order.title);
  const [asistansDosyaNo, setAsistansDosyaNo] = useState(order.asistansDosyaNo ?? "");
  const [description, setDescription] = useState(order.description ?? "");
  const [priority, setPriority] = useState(order.priority);
  const [insuranceCompanyId, setInsuranceCompanyId] = useState(order.insuranceCompany.id);
  const [insuredFirstName, setInsuredFirstName] = useState(order.insuredFirstName ?? "");
  const [insuredLastName, setInsuredLastName] = useState(order.insuredLastName ?? "");
  const [insuredPhone, setInsuredPhone] = useState(order.insuredPhone ?? "");
  const [insuredAddress, setInsuredAddress] = useState(order.insuredAddress ?? "");
  const [insuredCity, setInsuredCity] = useState(order.insuredCity ?? "");
  const [insuredDistrict, setInsuredDistrict] = useState(order.insuredDistrict ?? "");
  const [appointmentAt, setAppointmentAt] = useState(toDatetimeLocalValue(order.appointmentAt));
  const [supplierCost, setSupplierCost] = useState(formatCurrencyInput(order.supplierCost ?? 0));
  const [supplierId, setSupplierId] = useState(order.supplierId ?? "");
  const [repairLines, setRepairLines] = useState<RepairItemDraft[]>([newDraft()]);
  const [repairImageFiles, setRepairImageFiles] = useState<File[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [assigneeUpdating, setAssigneeUpdating] = useState(false);
  const [whatsappSending, setWhatsappSending] = useState(false);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);

  const company = useMemo(
    () => insuranceCompanies.find((item) => item.id === insuranceCompanyId) ?? order.insuranceCompany,
    [insuranceCompanies, insuranceCompanyId, order.insuranceCompany]
  );
  const selectedSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === supplierId),
    [suppliers, supplierId]
  );
  const whatsappReady = useMemo(
    () => validateSupplierWhatsAppSend(order, selectedSupplier?.phone),
    [order, selectedSupplier?.phone]
  );

  useEffect(() => {
    setJobType(order.jobType);
    setTitle(order.title);
    setAsistansDosyaNo(order.asistansDosyaNo ?? "");
    setDescription(order.description ?? "");
    setPriority(order.priority);
    setInsuranceCompanyId(order.insuranceCompany.id);
    setInsuredFirstName(order.insuredFirstName ?? "");
    setInsuredLastName(order.insuredLastName ?? "");
    setInsuredPhone(order.insuredPhone ?? "");
    setInsuredAddress(order.insuredAddress ?? "");
    setInsuredCity(order.insuredCity ?? "");
    setInsuredDistrict(order.insuredDistrict ?? "");
    setAppointmentAt(toDatetimeLocalValue(order.appointmentAt));
    setSupplierCost(formatCurrencyInput(order.supplierCost ?? 0));
    setSupplierId(order.supplierId ?? "");
    setFormError(null);
    const effectiveItems = getEffectiveRepairItems(order);
    setRepairLines(
      effectiveItems.length > 0
        ? effectiveItems.map((i: WorkOrderRepairItem) => newDraft({ description: i.description, amount: i.amount }))
        : [newDraft()]
    );
  }, [order]);

  const invoice = repairLines.reduce((sum, line) => sum + parseCurrencyInput(line.amount), 0);
  const supplier = parseCurrencyInput(supplierCost);
  const profit = invoice - supplier;

  function updateLine(key: string, field: "description" | "amount", value: string) {
    setRepairLines((lines) =>
      lines.map((line) => (line.key === key ? { ...line, [field]: value } : line))
    );
  }

  function addLine() {
    setRepairLines((lines) => [...lines, newDraft()]);
  }

  function removeLine(key: string) {
    setRepairLines((lines) => (lines.length <= 1 ? [newDraft()] : lines.filter((l) => l.key !== key)));
  }

  async function uploadRepairImages() {
    if (repairImageFiles.length === 0) {
      setImageError("Yüklenecek görsel seçin.");
      return;
    }

    setUploadingImages(true);
    setImageError(null);
    try {
      const body = new FormData();
      repairImageFiles.forEach((file) => body.append("files", file));

      const res = await apiFetch(`/api/work-orders/${order.id}/repair-images`, {
        method: "POST",
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImageError(typeof data.error === "string" ? data.error : "Görseller yüklenemedi.");
        return;
      }
      setRepairImageFiles([]);
      router.refresh();
    } finally {
      setUploadingImages(false);
    }
  }

  async function deleteRepairImage(imageId: string) {
    setDeletingImageId(imageId);
    try {
      const res = await apiFetch(
        `/api/work-orders/${order.id}/repair-images/${encodeURIComponent(imageId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) return;
      router.refresh();
    } finally {
      setDeletingImageId(null);
    }
  }

  async function handleWhatsAppSend() {
    if (!supplierId) {
      setWhatsappError(`Önce ${domainLabels.supplier.one.toLowerCase()} seçin.`);
      return;
    }

    setWhatsappSending(true);
    setWhatsappError(null);
    try {
      const res = await apiFetch(`/api/work-orders/${order.id}/whatsapp-supplier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWhatsappError(typeof data.error === "string" ? data.error : "WhatsApp açılamadı.");
        return;
      }
      if (typeof data.url === "string") {
        window.open(data.url, "_blank", "noopener,noreferrer");
      }
      router.refresh();
    } finally {
      setWhatsappSending(false);
    }
  }

  async function handleSave() {
    if (!title.trim() || !asistansDosyaNo.trim()) {
      setFormError("Dosya No ve Asistans Dosya No zorunludur.");
      return;
    }
    if (!insuranceCompanyId) {
      setFormError(`${domainLabels.insuranceCompany.one} seçilmelidir.`);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        asistansDosyaNo: asistansDosyaNo.trim(),
        description: description.trim() || null,
        priority,
        insuranceCompanyId,
        insuredFirstName: insuredFirstName.trim() || null,
        insuredLastName: insuredLastName.trim() || null,
        insuredPhone: insuredPhone.trim() || null,
        insuredAddress: insuredAddress.trim() || null,
        insuredCity: insuredCity.trim() || null,
        insuredDistrict: insuredDistrict.trim() || null,
        appointmentAt: appointmentAt ? new Date(appointmentAt).toISOString() : null,
        supplierCost: parseCurrencyInput(supplierCost),
        supplierId: supplierId || null,
      };

      payload.repairItems = repairLines
        .filter((l) => l.description.trim() && parseCurrencyInput(l.amount) > 0)
        .map((l) => ({ description: l.description.trim(), amount: parseCurrencyInput(l.amount) }));

      const res = await apiFetch(`/api/work-orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(typeof data.error === "string" ? data.error : "Kaydedilemedi.");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    if (newStatus === order.status) return;

    setStatusUpdating(true);
    try {
      const res = await apiFetch(`/api/work-orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          supplierId: supplierId || null,
          supplierCost: parseCurrencyInput(supplierCost),
        }),
      });
      if (!res.ok) return;

      if (isWorkOrderClosed(newStatus)) {
        router.push("/work-orders?tab=completed");
      } else {
        router.refresh();
      }
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleJobTypeChange(nextJobType: string) {
    if (nextJobType === order.jobType) return;

    setJobTypeUpdating(true);
    try {
      const res = await apiFetch(`/api/work-orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobType: nextJobType }),
      });
      if (!res.ok) {
        setJobType(order.jobType);
        return;
      }
      setJobType(nextJobType);
      router.refresh();
    } finally {
      setJobTypeUpdating(false);
    }
  }

  async function handleAssigneeChange(nextAssignedToId: string) {
    const current = order.assignedTo?.id ?? "";
    if (nextAssignedToId === current) return;

    setAssigneeUpdating(true);
    try {
      const res = await apiFetch(`/api/work-orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedToId: nextAssignedToId || null }),
      });
      if (res.ok) router.refresh();
    } finally {
      setAssigneeUpdating(false);
    }
  }

  return (
    <div className="animate-fade-in">
      <Link
        href={backHref}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800"
      >
        <ArrowLeft className="h-4 w-4" /> Talep kayıtlarına dön
      </Link>

      <PageHeader
        title={order.ticketNo}
        description={`${domainLabels.workOrder.ticket}: ${order.title}${order.asistansDosyaNo ? ` · ${domainLabels.workOrder.assistanceFileNo}: ${order.asistansDosyaNo}` : ""}`}
        breadcrumb={["Ana Sayfa", "Talep Kayıtları", order.ticketNo]}
        action={
          canWrite ? (
            <Button variant="accent" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Kaydediliyor…" : "Değişiklikleri Kaydet"}
            </Button>
          ) : undefined
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge className={workOrderStatusColors[order.status]}>
          {workOrderStatusLabels[order.status]}
        </Badge>
        <span className={cn("text-sm font-medium", priorityColors[priority])}>
          {priorityLabels[priority]}
        </span>
        <span className="rounded-lg bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
          {jobTypeLabel}
        </span>
      </div>

      {formError && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      {order.hasFirmInvoice && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Bu iş {order.firmInvoiceNo ? `${order.firmInvoiceNo} numaralı faturaya` : "bir firmaya faturasına"} kayıtlı.
          Onarım kalemlerinde yapacağınız değişiklikler fatura toplamını otomatik güncellemez.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Talep" />
          <CardBody className="space-y-3">
            {canWrite ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label={domainLabels.workOrder.ticket}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
                <Input
                  label={domainLabels.workOrder.assistanceFileNo}
                  value={asistansDosyaNo}
                  onChange={(e) => setAsistansDosyaNo(e.target.value)}
                  required
                />
              </div>
            ) : (
              <>
                <DetailField label={domainLabels.workOrder.ticket} value={order.title} />
                <DetailField label={domainLabels.workOrder.assistanceFileNo} value={order.asistansDosyaNo} />
              </>
            )}
            {canWrite ? (
              <Select
                label="İş Türü"
                value={jobType}
                disabled={jobTypeUpdating}
                onChange={(e) => void handleJobTypeChange(e.target.value)}
                options={jobTypeOptions}
              />
            ) : (
              <DetailField label="İş Türü" value={jobTypeLabel} />
            )}
            {canWrite ? (
              <Textarea
                label="Detaylı Açıklama"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Olay yeri, araç bilgisi, poliçe notları..."
              />
            ) : order.description ? (
              <div>
                <p className="text-xs font-medium text-zinc-500">Açıklama</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                  {order.description}
                </p>
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <DetailField label="Bildirim" value={formatDateTime(order.reportedAt)} />
              <DetailField
                label="Tamamlanma"
                value={order.completedAt ? formatDateTime(order.completedAt) : null}
              />
              {canWrite ? (
                <Select
                  label="Öncelik"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  options={PRIORITY_OPTIONS}
                />
              ) : (
                <DetailField label="Öncelik" value={priorityLabels[order.priority]} />
              )}
              <div className="sm:col-span-2">
                {canWrite ? (
                  <Select
                    label="Planlayıcı"
                    value={order.assignedTo?.id ?? ""}
                    disabled={assigneeUpdating}
                    onChange={(e) => void handleAssigneeChange(e.target.value)}
                    options={responsibleSelectOptions(responsibles, order.assignedTo)}
                  />
                ) : (
                  <DetailField label="Atanan Planlayıcı" value={order.assignedTo?.name} />
                )}
              </div>
              {canWrite ? (
                <Input
                  label="Randevu tarihi"
                  type="datetime-local"
                  value={appointmentAt}
                  onChange={(e) => setAppointmentAt(e.target.value)}
                />
              ) : (
                <DetailField
                  label="Randevu"
                  value={order.appointmentAt ? formatDateTime(order.appointmentAt) : null}
                />
              )}
            </div>
            <p className="text-xs text-zinc-500">Randevu tarihi koordinatörün takvimine otomatik eklenir.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Durum" />
          <CardBody className="space-y-4">
            {canWrite ? (
              <Select
                label="Talep Durumu"
                value={order.status}
                disabled={statusUpdating}
                onChange={(e) => void handleStatusChange(e.target.value)}
                options={workOrderStatusFlow.map((status) => ({
                  value: status,
                  label: workOrderStatusLabels[status] ?? status,
                }))}
              />
            ) : (
              <DetailField label="Durum" value={workOrderStatusLabels[order.status]} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Sigortalı Bilgileri" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {canWrite ? (
              <>
                <Input
                  label="Ad"
                  value={insuredFirstName}
                  onChange={(e) => setInsuredFirstName(e.target.value)}
                />
                <Input
                  label="Soyad"
                  value={insuredLastName}
                  onChange={(e) => setInsuredLastName(e.target.value)}
                />
                <Input
                  label="Telefon"
                  value={insuredPhone}
                  onChange={(e) => setInsuredPhone(e.target.value)}
                  placeholder="05xx xxx xx xx"
                />
                <div className="sm:col-span-2">
                  <Input
                    label="Adres"
                    value={insuredAddress}
                    onChange={(e) => setInsuredAddress(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <ProvinceDistrictPicker
                    province={insuredCity}
                    district={insuredDistrict}
                    onProvinceChange={setInsuredCity}
                    onDistrictChange={setInsuredDistrict}
                  />
                </div>
              </>
            ) : (
              <>
                <DetailField label="Ad" value={order.insuredFirstName} />
                <DetailField label="Soyad" value={order.insuredLastName} />
                <DetailField label="Telefon" value={order.insuredPhone} />
                <DetailField label="İl" value={order.insuredCity} />
                <DetailField label="İlçe" value={order.insuredDistrict} />
                <div className="sm:col-span-2">
                  <DetailField label="Adres" value={order.insuredAddress} />
                </div>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Sigorta Şirketi & Lokasyon" />
          <CardBody>
            {canWrite ? (
              <div className="space-y-4">
                <InsuranceCompanyPicker
                  companies={insuranceCompanies}
                  value={insuranceCompanyId}
                  onChange={setInsuranceCompanyId}
                  label={`${domainLabels.insuranceCompany.shortCode} / ${domainLabels.insuranceCompany.one} seçimi`}
                  showContactSummary={false}
                />
                <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 ring-1 ring-zinc-100">
                  {companyLocationLine(company) || "Adres bilgisi yok"}
                </p>
                <InsuranceCompanyLocationSummary company={company} />
              </div>
            ) : (
              <>
                <div className="mb-4 grid gap-4 sm:grid-cols-2">
                  <DetailField label="Kısa kod" value={company.shortCode} />
                  <DetailField label={domainLabels.insuranceCompany.one} value={company.name} />
                  <DetailField label="Şehir" value={company.city} />
                </div>
                <InsuranceCompanyLocationSummary company={company} />
              </>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Onarım Kalemleri" />
          <CardBody>
            {canWrite ? (
              <div className="space-y-4">
                {repairLines.map((line) => (
                  <div
                    key={line.key}
                    className="grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/50 p-4 sm:grid-cols-[minmax(0,1fr)_180px_44px] sm:items-end"
                  >
                    <Input
                      label="Açıklama"
                      value={line.description}
                      onChange={(e) => updateLine(line.key, "description", e.target.value)}
                      placeholder="Örn: Kompresör değişimi"
                    />
                    <CurrencyInput
                      label="Tutar (₺)"
                      value={line.amount}
                      onChange={(value) => updateLine(line.key, "amount", value)}
                      placeholder="0"
                    />
                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-400 ring-1 ring-zinc-200 transition-colors hover:bg-red-50 hover:text-red-600 hover:ring-red-100 sm:mb-0.5"
                      aria-label="Kalemi sil"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button type="button" variant="secondary" size="sm" onClick={addLine}>
                  <Plus className="h-4 w-4" /> Kalem Ekle
                </Button>
                <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3">
                  <span className="text-sm font-medium text-zinc-700">Firmaya Fatura Toplamı</span>
                  <span className="text-base font-semibold text-zinc-900">{formatCurrency(invoice)}</span>
                </div>
              </div>
            ) : getEffectiveRepairItems(order).length > 0 ? (
              <div className="space-y-2">
                {getEffectiveRepairItems(order).map((item: WorkOrderRepairItem) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3"
                  >
                    <span className="text-sm text-zinc-800">{item.description}</span>
                    <span className="text-sm font-semibold text-zinc-900">{formatCurrency(item.amount)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-zinc-200 pt-3">
                  <span className="text-sm font-medium text-zinc-700">Toplam</span>
                  <span className="text-sm font-semibold text-zinc-900">{formatCurrency(order.invoiceAmount)}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-zinc-400">Onarım kalemi girilmemiş</p>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Onarım Görselleri" />
          <CardBody className="space-y-4">
            {order.repairImages.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {order.repairImages.map((image: WorkOrderRepairImage) => (
                  <div
                    key={image.id}
                    className="overflow-hidden rounded-2xl border border-zinc-200 bg-white"
                  >
                    <a
                      href={`/api/work-orders/${order.id}/repair-images/${image.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block aspect-[4/3] bg-zinc-100"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/work-orders/${order.id}/repair-images/${image.id}`}
                        alt={image.fileName}
                        className="h-full w-full object-cover"
                      />
                    </a>
                    <div className="space-y-2 px-3 py-2">
                      <p className="truncate text-xs text-zinc-500">{image.fileName}</p>
                      <div className="flex items-center gap-1">
                        <a
                          href={`/api/work-orders/${order.id}/repair-images/${image.id}?download=1`}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-indigo-50 px-2 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                        >
                          <FileDown className="h-3.5 w-3.5" />
                          İndir
                        </a>
                        {canWrite && (
                          <button
                            type="button"
                            disabled={deletingImageId === image.id}
                            onClick={() => void deleteRepairImage(image.id)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 ring-1 ring-zinc-200 transition hover:bg-red-50 hover:text-red-600 hover:ring-red-100 disabled:opacity-50"
                            aria-label="Görseli sil"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-400">Henüz onarım görseli yüklenmemiş.</p>
            )}

            {canWrite && (
              <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/60 p-4">
                <label className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-700">
                  <ImagePlus className="h-4 w-4 text-indigo-600" />
                  Görsel Yükle
                </label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  multiple
                  onChange={(e) => {
                    setRepairImageFiles(Array.from(e.target.files ?? []));
                    setImageError(null);
                  }}
                  className="block w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-indigo-700"
                />
                {repairImageFiles.length > 0 && (
                  <p className="mt-2 text-xs text-zinc-500">
                    {repairImageFiles.length} görsel seçildi
                  </p>
                )}
                <p className="mt-1 text-xs text-zinc-400">
                  JPG, PNG, WEBP — dosya başına en fazla 10 MB, tek seferde en fazla 10 görsel
                </p>
                {imageError && <p className="mt-2 text-sm text-red-600">{imageError}</p>}
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={uploadingImages || repairImageFiles.length === 0}
                    onClick={() => void uploadRepairImages()}
                  >
                    {uploadingImages ? "Yükleniyor…" : "Görselleri Yükle"}
                  </Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={`Maliyet & ${domainLabels.supplier.one}`} />
          <CardBody>
            {canWrite ? (
              <div className="grid gap-6 lg:grid-cols-2">
                <SupplierPicker
                  suppliers={suppliers}
                  value={supplierId}
                  onChange={(id) => {
                    setSupplierId(id);
                    setWhatsappError(null);
                  }}
                  label={`${domainLabels.supplier.one} Seçimi`}
                />
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    WhatsApp ile iletim
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Mesaj yalnızca sigortalı ad, telefon ve adres içerir. Alıcı: caride kayıtlı {domainLabels.supplier.one.toLowerCase()} telefonu.
                  </p>
                  {selectedSupplier?.phone ? (
                    <p className="mt-2 text-sm font-medium text-zinc-800">
                      {selectedSupplier.firstName} {selectedSupplier.lastName} · {selectedSupplier.phone}
                    </p>
                  ) : selectedSupplier ? (
                    <p className="mt-2 text-sm text-amber-700">Bu {domainLabels.supplier.one.toLowerCase()}nın carisinde telefon tanımlı değil.</p>
                  ) : null}
                  {whatsappReady.ok ? (
                    <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-3 text-xs leading-relaxed text-zinc-700">
                      {buildSupplierJobWhatsAppMessage(order)}
                    </pre>
                  ) : supplierId ? (
                    <p className="mt-3 text-sm text-amber-700">{whatsappReady.error}</p>
                  ) : null}
                  {whatsappError && (
                    <p className="mt-3 text-sm text-red-600">{whatsappError}</p>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-3 border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                    disabled={!whatsappReady.ok || whatsappSending}
                    onClick={() => void handleWhatsAppSend()}
                  >
                    {whatsappSending ? "Açılıyor…" : "WhatsApp ile Gönder"}
                  </Button>
                </div>
                <div className="space-y-4">
                  <CurrencyInput
                    label={`${domainLabels.supplier.one}ya Ödenen Tutar (₺)`}
                    value={supplierCost}
                    onChange={setSupplierCost}
                    placeholder="0"
                  />
                  <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                    <span className="text-sm text-zinc-500">Tahmini Kâr</span>
                    <span className={cn("text-base font-semibold", profit >= 0 ? "text-emerald-600" : "text-red-600")}>
                      {formatCurrency(profit)}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {order.supplier && (
                  <>
                    <DetailField
                      label={domainLabels.supplier.one}
                      value={`${order.supplier.firstName} ${order.supplier.lastName}`}
                    />
                    <DetailField label="IBAN" value={order.supplier.iban} />
                  </>
                )}
                <DetailField label="Firmaya Fatura Edilecek" value={formatCurrency(order.invoiceAmount)} />
                <DetailField label={`${domainLabels.supplier.one}ya Ödenen`} value={formatCurrency(order.supplierCost)} />
                <DetailField label="Kâr" value={formatCurrency(order.invoiceAmount - order.supplierCost)} />
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardBody>
            <OperatorNotesChat
              workOrderId={order.id}
              initialNotes={order.operatorNotes}
              canWrite={canWrite}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
