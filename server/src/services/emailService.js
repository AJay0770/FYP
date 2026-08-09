const nodemailer = require('nodemailer');

/**
 * SMTP is only wired up when real credentials are present.
 *
 * If SMTP_USER/SMTP_PASS are missing or still the .env.example placeholders, the
 * service logs what it *would* have sent and reports `skipped` instead of
 * attempting delivery. Two reasons: unconfigured cron jobs shouldn't throw on
 * every run, and a half-configured environment must never fire real email at
 * real client addresses by accident.
 */
const PLACEHOLDER_VALUES = new Set([
  undefined,
  '',
  'your-mailtrap-user',
  'your-mailtrap-pass',
]);

function isConfigured() {
  return (
    !PLACEHOLDER_VALUES.has(process.env.SMTP_USER) &&
    !PLACEHOLDER_VALUES.has(process.env.SMTP_PASS) &&
    !!process.env.SMTP_HOST
  );
}

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  return transporter;
}

async function sendReportEmail({ to, projectName, reportType, pdfUrl, range }) {
  const subject = `${reportType} report — ${projectName}`;
  const text = [
    `${reportType} report for ${projectName}`,
    range ? `Period: ${range.from.slice(0, 10)} to ${range.to.slice(0, 10)}` : null,
    '',
    `Download: ${pdfUrl}`,
    '',
    'BuildSite 360',
  ]
    .filter(Boolean)
    .join('\n');

  if (!isConfigured()) {
    console.log(
      `[email skipped — SMTP not configured] would send "${subject}" to ${to} with ${pdfUrl}`
    );
    return { sent: false, skipped: true, reason: 'SMTP not configured' };
  }

  const info = await getTransporter().sendMail({
    from: process.env.SMTP_FROM || 'BuildSite 360 <noreply@buildsite360.local>',
    to,
    subject,
    text,
  });

  return { sent: true, skipped: false, messageId: info.messageId };
}

module.exports = { sendReportEmail, isConfigured };
