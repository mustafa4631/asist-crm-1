import { ImapFlow, type ImapFlowOptions } from "imapflow";
import type { MailSetting } from "@prisma/client";
import { extractMailErrorDetail, resolveImapConnection } from "./mail-tls";

const IMAP_LOGIN_METHODS = [undefined, "LOGIN", "AUTH=LOGIN", "AUTH=PLAIN"] as const;

function isAuthError(err: unknown): boolean {
  const detail = extractMailErrorDetail(err).toLowerCase();
  return /auth|authenticate|credentials|invalid login|login failed|535|534/.test(detail);
}

function buildImapOptions(settings: MailSetting, loginMethod?: string): ImapFlowOptions {
  const base = resolveImapConnection(settings);
  return {
    ...base,
    auth: {
      ...base.auth,
      ...(loginMethod ? { loginMethod } : {}),
    },
  };
}

export async function connectImapClient(settings: MailSetting): Promise<ImapFlow> {
  let lastError: unknown;

  for (const loginMethod of IMAP_LOGIN_METHODS) {
    const client = new ImapFlow(buildImapOptions(settings, loginMethod));
    client.on("error", (err) => {
      // prevent unhandled event exception
    });

    try {
      await client.connect();
      return client;
    } catch (err) {
      lastError = err;
      try {
        await client.logout();
      } catch {
        /* ignore */
      }
      if (!isAuthError(err)) {
        throw err;
      }
    }
  }

  throw lastError;
}
