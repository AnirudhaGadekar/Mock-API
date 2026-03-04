/**
 * Mailer — using Resend for transactional email delivery.
 * Docs: https://resend.com/docs
 */
import { Resend } from 'resend';
import { logger } from './logger.js';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_ADDRESS = process.env.RESEND_FROM || 'onboarding@resend.dev';

/**
 * Send a 6-digit OTP to the given email address.
 */
export async function sendOtpEmail(to: string, otp: string): Promise<void> {
  // DEV BYPASS: skip real email sending in local development
  const isDev = process.env.NODE_ENV !== 'production';
  const isDevBypass = process.env.AUTH_MODE === 'dev-bypass';
  if (isDev && isDevBypass) {
    logger.warn(`[DEV-BYPASS] OTP for ${to}: ${otp}  ← shown only in dev-bypass mode`);
    return; // Do NOT send email
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Your MockURL Login Code</title>
</head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0"
               style="background:#1e293b;border-radius:12px;border:1px solid #334155;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">
                🔐 MockURL
              </h1>
              <p style="margin:8px 0 0;color:#c4b5fd;font-size:14px;">One-Time Login Code</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 32px;">
              <p style="color:#94a3b8;font-size:15px;margin:0 0 24px;">
                Use the code below to sign in to MockURL. This code expires in
                <strong style="color:#e2e8f0;">5 minutes</strong>.
              </p>
              <!-- OTP Box -->
              <div style="background:#0f172a;border:1px solid #4f46e5;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px;">
                <span style="font-size:42px;font-weight:800;letter-spacing:12px;color:#818cf8;font-family:'Courier New',monospace;">
                  ${otp}
                </span>
              </div>
              <p style="color:#64748b;font-size:13px;margin:0;">
                If you didn't request this code, you can safely ignore this email.
                Never share this code with anyone.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;background:#0f172a;border-top:1px solid #1e293b;text-align:center;">
              <p style="margin:0;color:#475569;font-size:12px;">
                MockURL &mdash; Mock API endpoints, instantly.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject: `${otp} is your MockURL login code`,
    html,
  });

  if (error) {
    logger.error('Resend failed to deliver OTP email', { error, to });
    throw new Error(`Email delivery failed: ${error.message}`);
  }

  logger.info('OTP email sent via Resend', { to });
}
