import type { Context } from "telegraf";
import type { Replier } from "./approval-sessions.ts";

const DEFAULT_API_ROOT = "https://api.telegram.org";

/**
 * Sends a file using Bun's own fetch + FormData.
 *
 * Why not ctx.replyWithDocument()? Telegraf 4.16 builds the upload with a
 * streaming form that never finishes under Bun 1.4.2 (the request hangs and the
 * socket is closed). Plain messages work, only uploads hang.
 */
export async function sendDocumentNative(opts: {
  token: string;
  apiRoot?: string;
  chatId: number | string;
  source: Buffer;
  filename: string;
}): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(opts.chatId));
  form.append("document", new Blob([opts.source], { type: "text/plain" }), opts.filename);

  let res: Response;
  try {
    res = await fetch(`${opts.apiRoot ?? DEFAULT_API_ROOT}/bot${opts.token}/sendDocument`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    // Do not include the URL: it contains the bot token.
    throw new Error(`sendDocument request failed: ${(e as Error).name}`);
  }
  const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!res.ok || !json?.ok) {
    throw new Error(`sendDocument failed: HTTP ${res.status} ${json?.description ?? ""}`.trim());
  }
}

/** Wraps a Telegraf context so that files go out through sendDocumentNative. */
export function withNativeUpload(ctx: Context): Replier {
  return {
    reply: (t, o) => ctx.reply(t, o as never),
    replyWithDocument: ({ source, filename }) =>
      sendDocumentNative({
        token: ctx.telegram.token,
        apiRoot: ctx.telegram.options?.apiRoot,
        chatId: ctx.chat!.id,
        source,
        filename,
      }),
  };
}