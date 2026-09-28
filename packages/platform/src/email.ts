/**
 * Email, through Amazon SES, from the platform's own domain:
 *
 *   alerts@zuuvy.site     new-order alerts to a business
 *   no-reply@zuuvy.site   everything else — welcome, a domain connected
 *
 * Every email is an outbox job ("email.send") written in the transaction of
 * whatever caused it, so an order never waits for, or fails because of, an
 * email; a failed send retries with backoff. Sending is off unless
 * EMAIL_ENABLED=1 — a laptop or a test logs the message instead.
 *
 * SES starts every account in its sandbox, where it only delivers to
 * verified addresses; production access is a request in the SES console.
 */
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { config, loadRootEnv } from "./config";
import { type Tx, UserError, withTenant } from "./db";
import { PermanentError, enqueue } from "./outbox";

export type Sender = "alerts" | "no-reply";

export type Email = { to: string; from: Sender; subject: string; text: string; html: string };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function emailDomain(): string {
  loadRootEnv();
  return process.env.EMAIL_DOMAIN || config.platformDomain();
}

export function fromAddress(sender: Sender): string {
  const name = sender === "alerts" ? "Zuuvy Sites Alerts" : "Zuuvy Sites";
  return `${name} <${sender}@${emailDomain()}>`;
}

export async function queueEmail(tx: Tx, email: Email): Promise<void> {
  if (!EMAIL.test(email.to)) return;
  await enqueue(tx, "email.send", email as unknown as Record<string, unknown>);
}

type SesSender = { send(c: SendEmailCommand): Promise<unknown> };
let clientOverride: SesSender | undefined;
export const sentForTests: Email[] = [];
export function setEmailClient(c: SesSender | undefined): void {
  clientOverride = c;
}

/** Job: send one email. */
export async function sendEmail(email: Email): Promise<void> {
  loadRootEnv();
  if (!clientOverride && process.env.EMAIL_ENABLED !== "1") {
    sentForTests.push(email);
    console.log(`email (not sent — EMAIL_ENABLED is off): ${email.from}@ → ${email.to}: ${email.subject}`);
    return;
  }
  const client = clientOverride ?? new SESv2Client({ region: process.env.SES_REGION || process.env.AWS_REGION || "ap-south-1" });
  try {
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: fromAddress(email.from),
        Destination: { ToAddresses: [email.to] },
        ...(process.env.SES_CONFIGURATION_SET ? { ConfigurationSetName: process.env.SES_CONFIGURATION_SET } : {}),
        Content: {
          Simple: {
            Subject: { Data: email.subject, Charset: "UTF-8" },
            Body: { Text: { Data: email.text, Charset: "UTF-8" }, Html: { Data: email.html, Charset: "UTF-8" } },
          },
        },
      }),
    );
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    // A rejected address or an unverified sender will not fix itself on retry.
    if (/MessageRejected|MailFromDomainNotVerified|AccountSuspended|SendingPaused|BadRequest|NotFound/i.test(name)) {
      throw new PermanentError(`SES refused the email to ${email.to}: ${(e as Error).message}`);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** One simple, readable layout; the text part says the same thing. */
function layout(title: string, paragraphs: string[], action?: { label: string; url: string }, footer = "You are receiving this because of your Zuuvy Sites account."): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f5ff;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px 32px 8px"><div style="font-weight:700;font-size:15px;color:#4f46e5">Zuuvy Sites</div></td></tr>
<tr><td style="padding:8px 32px 8px"><h1 style="margin:0 0 12px;font-size:22px;line-height:1.3">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#374151">${esc(p)}</p>`).join("")}
${action ? `<p style="margin:20px 0 8px"><a href="${esc(action.url)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:9px">${esc(action.label)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:16px 32px 28px;font-size:12px;color:#6b7280;border-top:1px solid #f3f4f6">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

function text(title: string, paragraphs: string[], action?: { label: string; url: string }): string {
  return [title, "", ...paragraphs, ...(action ? ["", `${action.label}: ${action.url}`] : []), "", "— Zuuvy Sites"].join("\n");
}

export function welcomeEmail(to: string, name: string, business: string): Email {
  const studio = config.publicApiUrl();
  const title = `Welcome to Zuuvy Sites, ${name.split(" ")[0]}`;
  const body = [
    `${business} is set up. Pick a template, describe what you want in plain words, and the AI builds it — every change is a version you preview before it goes live.`,
    "You can connect your own domain, bring in products from Zuuvy, and get an email the moment an order comes in.",
  ];
  const action = { label: "Open the studio", url: `${studio}/sites/new` };
  return { to, from: "no-reply", subject: "Welcome to Zuuvy Sites", html: layout(title, body, action), text: text(title, body, action) };
}

export function orderAlertEmail(to: string, o: { number: number; business: string; total: number; customer: string; items: string[]; orderId: string }): Email {
  const studio = config.publicApiUrl();
  const title = `New order WEB-${o.number} — ₹${o.total.toLocaleString("en-IN")}`;
  const body = [`${o.customer} ordered from ${o.business}: ${o.items.join(", ")}.`, "Cash on delivery. Open the order to accept or decline it."];
  const action = { label: "Open the order", url: `${studio}/orders/${o.orderId}` };
  return {
    to,
    from: "alerts",
    subject: title,
    html: layout(title, body, action, "You get these because new-order alerts are on for this business. Change who receives them under Settings."),
    text: text(title, body, action),
  };
}

export function domainConnectedEmail(to: string, hostname: string, siteName: string): Email {
  const title = `${hostname} is live`;
  const body = [`${siteName} now answers at https://${hostname}, with a security certificate. Nothing else to do.`];
  const action = { label: `Visit ${hostname}`, url: `https://${hostname}` };
  return { to, from: "no-reply", subject: title, html: layout(title, body, action), text: text(title, body, action) };
}

// ---------------------------------------------------------------------------
// Alert settings
// ---------------------------------------------------------------------------

export type AlertSettings = { orders: boolean; emails: string[] };

export async function getAlerts(tx: Tx): Promise<AlertSettings> {
  const row = await tx.one<{ alerts: Partial<AlertSettings> }>("select alerts from tenants where id = app_tenant()");
  return { orders: row?.alerts?.orders ?? false, emails: row?.alerts?.emails ?? [] };
}

export async function setAlerts(tx: Tx, input: { orders: boolean; emails: string[] }): Promise<AlertSettings> {
  const emails = [...new Set(input.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const bad = emails.find((e) => !EMAIL.test(e));
  if (bad) throw new UserError(`${bad} is not an email address.`);
  if (emails.length > 10) throw new UserError("Up to 10 people can receive alerts.");
  if (input.orders && !emails.length) throw new UserError("Add at least one email to send order alerts to.");
  const alerts = { orders: input.orders, emails };
  await tx.query("update tenants set alerts = $1 where id = app_tenant()", [JSON.stringify(alerts)]);
  return alerts;
}

/** After signup: alerts on for the owner, and the welcome email. */
export async function onboard(tenantId: string, user: { email: string; name: string }, business: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx.query("update tenants set alerts = $1 where id = app_tenant() and alerts = '{}'::jsonb", [JSON.stringify({ orders: true, emails: [user.email] })]);
    await queueEmail(tx, welcomeEmail(user.email, user.name, business));
  });
}
