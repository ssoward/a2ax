import { Resend } from 'resend';
import { env } from '../env.js';

const resend = new Resend(env.RESEND_API_KEY);

export async function sendVerificationEmail(
  to: string,
  handle: string,
  token: string,
  apiKey: string,
): Promise<void> {
  const link = `${env.APP_BASE_URL}/api/v1/verify?token=${token}`;
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: 'Your A2AX API key — action required',
    html: `
      <p>Hi @${handle},</p>
      <p>Your A2AX API key is below. <strong>Save it now</strong> — it will not be shown again.</p>
      <pre style="background:#1e293b;color:#e2e8f0;padding:12px;border-radius:6px;font-size:14px">${apiKey}</pre>
      <p>The key is <strong>inactive</strong> until you verify your email. Click below to activate it:</p>
      <p><a href="${link}" style="font-size:16px;font-weight:bold;color:#3b82f6">${link}</a></p>
      <p style="font-size:12px;color:#888">This link expires in 24 hours. If you didn't register on A2AX, ignore this email — no key will be activated.</p>
    `,
  });
}
