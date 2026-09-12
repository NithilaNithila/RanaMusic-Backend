const nodemailer = require("nodemailer");
const { logger } = require("./logger.service");

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    logger.warn("SMTP not configured — emails will be logged to console");
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 5000,
  });

  return transporter;
};

const sendMail = async ({ to, subject, html, tokenPreview }) => {
  const transport = getTransporter();
  const from = process.env.SMTP_FROM || "RanaMusic <noreply@ranamusic.app>";

  if (!transport) {
    if (process.env.NODE_ENV === "production") {
      // Never "deliver" by writing a one-time reset token to stdout/logs where
      // it could be read by anyone watching the process. Fail the send instead
      // so the operator notices SMTP is misconfigured.
      throw new Error("SMTP is not configured — cannot deliver emails in production");
    }
    // Dev console fallback: log only a MASKED preview (first 8 chars) — never
    // the full token or the reset URL.
    logger.info({ to, subject, tokenPreview }, "EMAIL (console — SMTP not configured)");
    return { accepted: [to], message: "Logged to console (SMTP not configured)" };
  }

  const info = await transport.sendMail({ from, to, subject, html });
  logger.info({ to, messageId: info.messageId }, "Email sent");
  return info;
};

const sendPasswordResetEmail = async ({ to, resetToken, expiresIn }) => {
  const baseUrl = process.env.CLIENT_URL || "http://localhost:5173";
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
      <h2>RanaMusic — Password Reset</h2>
      <p>You requested a password reset. Click the link below to set a new password:</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;text-decoration:none;border-radius:6px">Reset Password</a></p>
      <p>This link expires in <strong>${expiresIn}</strong>.</p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    </div>
  `;

  return sendMail({
    to,
    subject: "RanaMusic — Reset Your Password",
    html,
    tokenPreview: resetToken.slice(0, 8),
  });
};

module.exports = { sendMail, sendPasswordResetEmail };
