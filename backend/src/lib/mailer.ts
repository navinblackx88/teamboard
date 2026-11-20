import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : nodemailer.createTransport({ jsonTransport: true }); // dev: log instead of send

export const sentEmails: { to: string; subject: string }[] = []; // inspected by tests

export async function sendEmail(to: string, subject: string, text: string, link?: string) {
  const url = link ? `${env.APP_URL}${link}` : env.APP_URL;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px">
      <h2 style="margin:0 0 12px;color:#4f46e5">TeamBoard</h2>
      <p style="font-size:15px;color:#0f172a;white-space:pre-line">${escapeHtml(text)}</p>
      <p><a href="${url}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open in TeamBoard</a></p>
      <p style="font-size:12px;color:#64748b">You can turn off email notifications in your profile settings.</p>
    </div>`;
  try {
    await transport.sendMail({ from: env.EMAIL_FROM, to, subject, text: `${text}\n\n${url}`, html });
    if (env.NODE_ENV !== "production") sentEmails.push({ to, subject });
    if (!env.SMTP_HOST) logger.debug({ to, subject }, "email (not sent: SMTP_HOST unset)");
  } catch (err) {
    logger.error({ err, to, subject }, "email send failed");
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
