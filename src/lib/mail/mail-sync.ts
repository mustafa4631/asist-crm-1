import { simpleParser, type AddressObject } from "mailparser";
import type { MailSetting, PrismaClient } from "@prisma/client";
import { saveMailAttachmentBuffer } from "./mail-files";
import { formatMailConnectionError } from "./mail-tls";
import { connectImapClient } from "./imap-connect";

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function flattenAddresses(input: AddressObject | AddressObject[] | undefined) {
  if (!input) return [];
  const groups = Array.isArray(input) ? input : [input];
  return groups.flatMap((group) => group.value ?? []);
}

function normalizeExternalId(messageId: string | undefined, uid: number): string {
  const trimmed = messageId?.trim();
  if (!trimmed) return `uid-${uid}@imap`;
  return trimmed.replace(/^<|>$/g, "");
}

export type MailSyncResult = {
  imported: number;
  scanned: number;
  skipped: number;
  failed: number;
  totalInMailbox: number;
  errors: string[];
};

export async function syncInboxFromImap(
  prisma: PrismaClient,
  settings: MailSetting
): Promise<MailSyncResult> {
  const client = await connectImapClient(settings);

  const result: MailSyncResult = {
    imported: 0,
    scanned: 0,
    skipped: 0,
    failed: 0,
    totalInMailbox: 0,
    errors: [],
  };

  let lock: { release: () => void } | null = null;

  try {
    lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox && typeof client.mailbox === "object" ? client.mailbox : null;
      result.totalInMailbox = mailbox?.exists ?? 0;
      if (result.totalInMailbox === 0) {
        return result;
      }

      const searchResult = await client.search({ all: true }, { uid: true });
      const allUids = searchResult === false ? [] : searchResult;
      if (allUids.length === 0) {
        return result;
      }

      const uidsToFetch = allUids.slice(-100);

      for (const uidBatch of chunk(uidsToFetch, 20)) {
        for await (const msg of client.fetch(uidBatch, { source: true, uid: true }, { uid: true })) {
          result.scanned += 1;

          if (!msg.source) {
            result.failed += 1;
            result.errors.push(`UID ${msg.uid}: mesaj içeriği alınamadı`);
            continue;
          }

          try {
            const parsed = await simpleParser(msg.source);
            const externalId = normalizeExternalId(parsed.messageId, msg.uid);

            const existing = await prisma.mailMessage.findUnique({ where: { externalId } });
            if (existing) {
              result.skipped += 1;
              continue;
            }

            const from = parsed.from?.value?.[0];
            const toList = flattenAddresses(parsed.to).map((a) =>
              a.name ? `${a.name} <${a.address}>` : a.address ?? ""
            );

            const created = await prisma.mailMessage.create({
              data: {
                folder: "INBOX",
                externalId,
                subject: parsed.subject?.trim() || "(Konu yok)",
                fromName: from?.name ?? null,
                fromEmail: from?.address ?? "bilinmiyor@local",
                toRecipients: JSON.stringify(toList.length ? toList : [settings.fromEmail ?? ""]),
                ccRecipients: flattenAddresses(parsed.cc).length
                  ? JSON.stringify(flattenAddresses(parsed.cc).map((a) => a.address).filter(Boolean))
                  : null,
                bodyText: parsed.text ?? "",
                bodyHtml: typeof parsed.html === "string" ? parsed.html : null,
                isRead: false,
                receivedAt: parsed.date ?? new Date(),
                hasAttachments: (parsed.attachments?.length ?? 0) > 0,
              },
            });

            for (const att of parsed.attachments ?? []) {
              if (!att.content || !att.filename) continue;
              const buffer = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
              const saved = await saveMailAttachmentBuffer(
                created.id,
                att.filename,
                att.contentType ?? "application/octet-stream",
                buffer
              );
              await prisma.mailAttachment.create({
                data: { ...saved, messageId: created.id },
              });
            }

            result.imported += 1;
          } catch (err) {
            result.failed += 1;
            result.errors.push(`UID ${msg.uid}: ${formatMailConnectionError(err, "imap")}`);
            console.error("[imap-sync]", err);
          }
        }
      }
    } finally {
      try {
        lock?.release();
      } catch {
        /* bağlantı kopmuş olabilir */
      }
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* kimlik doğrulama / bağlantı hatalarında logout sessizce yutulur */
    }
  }

  return result;
}

function buildSyncMessage(result: MailSyncResult): string {
  if (result.totalInMailbox === 0) {
    return "Sunucudaki gelen kutusu boş.";
  }
  if (result.scanned === 0) {
    return `Gelen kutusunda ${result.totalInMailbox} mail var ancak okunamadı. IMAP erişimini kontrol edin.`;
  }
  if (result.imported > 0) {
    return `${result.imported} yeni mail içe aktarıldı (${result.scanned} tarandı).`;
  }
  if (result.skipped > 0) {
    return `${result.scanned} mail tarandı; hepsi zaten içe aktarılmış.`;
  }
  if (result.failed > 0) {
    return `${result.failed} mail okunurken hata oluştu.`;
  }
  return "Senkron tamamlandı.";
}

export function summarizeMailSyncResult(result: MailSyncResult) {
  return {
    ...result,
    message: buildSyncMessage(result),
    ok: result.failed === 0 && (result.scanned > 0 || result.totalInMailbox === 0),
  };
}
