/**
 * Mailer using Resend for transactional email delivery.
 * Docs: https://resend.com/docs
 */
import { Resend } from 'resend';
import { ApiError } from './errors.js';
import { logger } from './logger.js';

const FROM_ADDRESS = process.env.RESEND_FROM || 'onboarding@resend.dev';

let resend: Resend | null = null;

function getResendClient(): Resend {
  if (!resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is required for email functionality');
    }
    resend = new Resend(apiKey);
  }
  return resend;
}

function mapResendError(to: string, error: any): ApiError {
  const message = error?.message ?? 'Email provider rejected the request';

  const isSandboxRestriction =
    error?.statusCode === 403 && typeof message === 'string' && message.includes('testing emails');

  if (isSandboxRestriction) {
    return new ApiError(
      'Email sending is disabled in this environment (Resend sandbox). Verify a domain on Resend and set RESEND_FROM to that domain, or use AUTH_MODE=dev-bypass while testing.',
      {
        statusCode: 503,
        code: 'EMAIL_PROVIDER_SANDBOX',
        meta: { provider: 'resend', to },
      }
    );
  }

  return new ApiError(`Email delivery failed: ${message}`, {
    statusCode: error?.statusCode ?? 502,
    code: 'EMAIL_PROVIDER_ERROR',
    meta: { provider: 'resend', to },
  });
}

function isLocalhostLike(value: string): boolean {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/**
 * Send a 6-digit OTP to the given email address.
 */
export async function sendOtpEmail(to: string, otp: string): Promise<void> {
  const isDev = process.env.NODE_ENV !== 'production';
  const isDevBypass = process.env.AUTH_MODE === 'dev-bypass';
  const resendKeyMissing = !process.env.RESEND_API_KEY;

  if (isDev && isDevBypass) {
    logger.warn(`[DEV-BYPASS] OTP for ${to}: ${otp}`);
    return;
  }

  if (isDev && resendKeyMissing) {
    logger.warn(`[DEV] OTP for ${to}: ${otp}`);
    return;
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Your MockAPI Login Code</title>
</head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0"
               style="background:#1e293b;border-radius:12px;border:1px solid #334155;overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">
                MockAPI
              </h1>
              <p style="margin:8px 0 0;color:#c4b5fd;font-size:14px;">One-Time Login Code</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 32px;">
              <p style="color:#94a3b8;font-size:15px;margin:0 0 24px;">
                Use the code below to sign in to MockAPI. This code expires in
                <strong style="color:#e2e8f0;">5 minutes</strong>.
              </p>
              <div style="background:#0f172a;border:1px solid #4f46e5;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px;">
                <span style="font-size:42px;font-weight:800;letter-spacing:12px;color:#818cf8;font-family:'Courier New',monospace;">
                  ${otp}
                </span>
              </div>
              <p style="color:#64748b;font-size:13px;margin:0;">
                If you did not request this code, you can safely ignore this email.
                Never share this code with anyone.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background:#0f172a;border-top:1px solid #1e293b;text-align:center;">
              <p style="margin:0;color:#475569;font-size:12px;">
                MockAPI - Mock API endpoints, instantly.
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

  try {
    const { error } = await getResendClient().emails.send({
      from: FROM_ADDRESS,
      to,
      subject: `${otp} is your MockAPI login code`,
      html,
    });

    if (error) {
      throw mapResendError(to, error);
    }
  } catch (error: any) {
    logger.error('Resend failed to deliver OTP email', { error, to });
    if (error instanceof ApiError) {
      throw error;
    }
    throw mapResendError(to, error);
  }

  logger.info('OTP email sent via Resend', { to });
}

export async function sendVerificationEmail(to: string, verificationToken: string): Promise<void> {
  const configuredFrontendUrl = process.env.FRONTEND_URL?.trim();
  const configuredBaseUrl = process.env.BASE_ENDPOINT_URL?.trim();
  const isProd = process.env.NODE_ENV === 'production';
  const frontendUrl = (configuredFrontendUrl || configuredBaseUrl || 'http://localhost:5173').replace(/\/+$/, '');

  if (isProd) {
    if (!configuredFrontendUrl) {
      throw new Error('FRONTEND_URL must be set in production for verification emails');
    }
    if (isLocalhostLike(configuredFrontendUrl)) {
      throw new Error(`Invalid FRONTEND_URL in production: ${configuredFrontendUrl}`);
    }
  }

  const verifyUrl = `${frontendUrl}/verify-email?token=${encodeURIComponent(verificationToken)}`;

  const isDev = process.env.NODE_ENV !== 'production';
  const resendKeyMissing = !process.env.RESEND_API_KEY;
  if (isDev && resendKeyMissing) {
    logger.warn(`[DEV] Verification link for ${to}: ${verifyUrl}`);
    return;
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Verify your MockAPI account</title>
</head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0"
               style="background:#1e293b;border-radius:12px;border:1px solid #334155;overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,#0ea5e9,#2563eb);padding:32px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">MockAPI</h1>
              <p style="margin:8px 0 0;color:#bfdbfe;font-size:14px;">Verify your email address</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 20px;">
                Your account was created successfully. Click the button below to verify your email before signing in.
              </p>
              <p style="text-align:center;margin:28px 0;">
                <a href="${verifyUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">
                  Verify Email
                </a>
              </p>
              <p style="color:#64748b;font-size:12px;line-height:1.5;margin:0;">
                If the button does not work, copy and paste this URL:<br/>
                <span style="word-break:break-all;color:#93c5fd;">${verifyUrl}</span>
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

  try {
    const { error } = await getResendClient().emails.send({
      from: FROM_ADDRESS,
      to,
      subject: 'Verify your MockAPI account',
      html,
    });

    if (error) {
      throw mapResendError(to, error);
    }
  } catch (error: any) {
    logger.error('Resend failed to deliver verification email', { error, to });
    if (error instanceof ApiError) {
      throw error;
    }
    throw mapResendError(to, error);
  }

  logger.info('Verification email sent via Resend', { to });
}
