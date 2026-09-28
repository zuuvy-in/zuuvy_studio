/**
 * Files attached to an AI request: a brief (PDF, Word), a price list (Excel,
 * CSV), notes (text, Markdown), screenshots of sites the owner likes. They go
 * to the model as reading material for that one request and are not stored.
 *
 * Bedrock's limits decide the numbers: at most five documents of 4.5 MB each
 * in one request. The type is taken from the extension and, where a format
 * has a signature, confirmed from the bytes.
 */
import type { Attachment, AttachmentFormat } from "@zsite/ai";
import { UserError } from "./db";
import { sniffImage } from "./media";

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = Math.floor(4.5 * 1024 * 1024);
export const ATTACHMENT_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.html,.htm,.png,.jpg,.jpeg,.webp,.gif";

const BY_EXTENSION: Record<string, AttachmentFormat> = {
  pdf: "pdf", doc: "doc", docx: "docx", xls: "xls", xlsx: "xlsx", csv: "csv", txt: "txt", md: "md",
  html: "html", htm: "html", png: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp", gif: "gif",
};

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // docx and xlsx are zip archives
const OLE = [0xd0, 0xcf, 0x11, 0xe0]; // doc and xls are OLE compound files

export type RawFile = { name: string; bytes: Uint8Array };

export function toAttachments(files: RawFile[]): Attachment[] {
  const real = files.filter((f) => f.bytes.length > 0);
  if (real.length > MAX_ATTACHMENTS) throw new UserError(`Attach at most ${MAX_ATTACHMENTS} files to one request.`);
  return real.map((f) => {
    const name = f.name.split(/[\\/]/).pop()!.slice(0, 120) || "file";
    const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
    const format = BY_EXTENSION[ext];
    if (!format) throw new UserError(`${name}: attach PDF, Word, Excel, CSV, text or image files.`);
    if (f.bytes.length > MAX_ATTACHMENT_BYTES) throw new UserError(`${name} is larger than 4.5 MB.`);
    const b = f.bytes;
    const ok =
      format === "pdf" ? startsWith(b, [0x25, 0x50, 0x44, 0x46]) :
      format === "docx" || format === "xlsx" ? startsWith(b, ZIP) :
      format === "doc" || format === "xls" ? startsWith(b, OLE) :
      format === "png" || format === "jpeg" || format === "webp" || format === "gif" ? sniffImage(b)?.type === `image/${format}` :
      !b.subarray(0, 4096).includes(0); // text formats: no NUL bytes
    if (!ok) throw new UserError(`${name} does not look like a real .${ext} file.`);
    return { name, format, bytes: b };
  });
}
