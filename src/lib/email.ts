import { Resend } from 'resend';

const resend = new Resend(import.meta.env.RESEND_API_KEY);

export async function sendMagicLinkEmail(email: string, url: string) {
  await resend.emails.send({
    from: import.meta.env.EMAIL_FROM,
    to: email,
    subject: 'Sign in to umyar — blog',
    html: `
      <div style="font-family: Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <p style="font-size: 15px; font-weight: 700; letter-spacing: -0.01em; background: linear-gradient(to left, #dc2424, #4a569d); -webkit-background-clip: text; background-clip: text; color: transparent; margin: 0 0 24px;">
          umyar — blog
        </p>
        <h1 style="font-size: 20px; margin: 0 0 12px; color: #18181b;">Sign in</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #52525b; margin: 0 0 24px;">
          Click the button below to sign in. This link expires in 5 minutes and can only be used once.
        </p>
        <a href="${url}" style="display: inline-block; padding: 10px 20px; border-radius: 9999px; background: linear-gradient(to left, #dc2424, #4a569d); color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600;">
          Sign in
        </a>
        <p style="font-size: 12px; line-height: 1.6; color: #a1a1aa; margin: 24px 0 0;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });
}
