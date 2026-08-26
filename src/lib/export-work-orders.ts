import {
  workOrderStatusLabels,
  priorityLabels,
} from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";
import { APP_NAME } from "@/lib/brand";
import { domainLabels } from "@/lib/domain";
import {
  addReportBanner,
  applyColumnWidths,
  applyCurrencyFormat,
  createFlowCrmWorkbook,
  finalizeSheet,
  formatExportSubtitle,
  highlightPriorityCell,
  writeDataRow,
  writeHeaderRow,
  workbookToBuffer,
} from "@/lib/export-xlsx-style";

export interface ExportOrder {
  ticketNo: string;
  title: string;
  asistansDosyaNo: string | null;
  insuredFirstName: string | null;
  insuredLastName: string | null;
  insuredPhone: string | null;
  insuredAddress: string | null;
  insuredCity: string | null;
  insuredDistrict: string | null;
  description: string | null;
  jobType: string;
  status: string;
  priority: string;
  reportedAt: Date;
  completedAt: Date | null;
  invoiceAmount: number;
  supplierCost: number;
  insuranceCompany: {
    name: string;
  };
  assignedTo: { name: string } | null;
}

const HEADERS = [
  domainLabels.workOrder.ticket,
  domainLabels.workOrder.assistanceFileNo,
  domainLabels.insuranceCompany.one,
  "Sigortalı Adı",
  "Sigortalı Soyadı",
  "Sigortalı Telefon",
  "İl",
  "İlçe",
  "Adres",
  "Hizmet Türü",
  "Açıklama",
  "Öncelik",
  "Durum",
  domainLabels.planner.one,
  "Bildirim Tarihi",
  "Tamamlanma Tarihi",
  "Sigortaya Fatura (₺)",
  `${domainLabels.supplier.one} Maliyeti (₺)`,
  "Kâr (₺)",
];

const COLUMN_WIDTHS = [14, 16, 22, 16, 16, 16, 14, 14, 30, 18, 28, 12, 18, 18, 18, 18, 18, 20, 14];
const CURRENCY_COLUMNS = [17, 18, 19];
const PRIORITY_COLUMN = 12;

function orderToRow(o: ExportOrder, jobTypeLabelMap: Record<string, string>) {
  return [
    o.title ?? "",
    o.asistansDosyaNo ?? "",
    o.insuranceCompany?.name ?? "",
    o.insuredFirstName ?? "",
    o.insuredLastName ?? "",
    o.insuredPhone ?? "",
    o.insuredCity ?? "",
    o.insuredDistrict ?? "",
    o.insuredAddress ?? "",
    jobTypeLabelMap[o.jobType] ?? o.jobType,
    o.description ?? "",
    priorityLabels[o.priority] ?? o.priority,
    workOrderStatusLabels[o.status] ?? o.status,
    o.assignedTo?.name ?? "",
    formatDateTime(o.reportedAt),
    o.completedAt ? formatDateTime(o.completedAt) : "",
    o.invoiceAmount ?? 0,
    o.supplierCost ?? 0,
    (o.invoiceAmount ?? 0) - (o.supplierCost ?? 0),
  ];
}

export async function workOrdersToXlsx(
  orders: ExportOrder[],
  jobTypeLabelMap: Record<string, string> = {},
  sheetName: string = domainLabels.workOrder.many
): Promise<Buffer> {
  const workbook = createFlowCrmWorkbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31), {
    properties: { defaultRowHeight: 18 },
  });

  const headerRow = addReportBanner(
    sheet,
    `${APP_NAME} — ${sheetName}`,
    formatExportSubtitle(orders.length),
    HEADERS.length
  );

  writeHeaderRow(sheet, headerRow, HEADERS);
  applyColumnWidths(sheet, COLUMN_WIDTHS);

  let rowNumber = headerRow + 1;
  orders.forEach((order, index) => {
    writeDataRow(sheet, rowNumber, orderToRow(order, jobTypeLabelMap), index);
    const row = sheet.getRow(rowNumber);
    applyCurrencyFormat(row, CURRENCY_COLUMNS);
    highlightPriorityCell(row, PRIORITY_COLUMN, order.priority);
    rowNumber += 1;
  });

  finalizeSheet(sheet, headerRow, HEADERS.length, rowNumber - 1);
  return workbookToBuffer(workbook);
}
