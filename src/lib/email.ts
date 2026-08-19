import { Resend } from 'resend';
import { canonicalUrl } from './site';

const resend = new Resend(import.meta.env.RESEND_API_KEY);

// Resend accepts at most 100 messages per batch call (and rate-limits to 10
// req/s per team), so a broadcast is chunked and paced.
const BATCH_SIZE = 100;
const BATCH_PAUSE_MS = 250;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Shared chrome for every email we send: fixed width, brand wordmark, inline
// styles only (no <style> block — Gmail strips them from the body).
function shell(inner: string): string {
  return `
    <div style="font-family: Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <p style="font-size: 15px; font-weight: 700; letter-spacing: -0.01em; background: linear-gradient(to left, #dc2424, #4a569d); -webkit-background-clip: text; background-clip: text; color: transparent; margin: 0 0 24px;">
        umyar — blog
      </p>
      ${inner}
    </div>
  `;
}

function button(href: string, label: string): string {
  return `
    <a href="${href}" style="display: inline-block; padding: 10px 20px; border-radius: 9999px; background: linear-gradient(to left, #dc2424, #4a569d); color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600;">
      ${label}
    </a>
  `;
}

export async function sendMagicLinkEmail(email: string, url: string) {
  await resend.emails.send({
    from: import.meta.env.EMAIL_FROM,
    to: email,
    subject: 'Sign in to umyar — blog',
    html: shell(`
      <h1 style="font-size: 20px; margin: 0 0 12px; color: #18181b;">Sign in</h1>
      <p style="font-size: 14px; line-height: 1.6; color: #52525b; margin: 0 0 24px;">
        Click the button below to sign in. This link expires in 5 minutes and can only be used once.
      </p>
      ${button(url, 'Sign in')}
      <p style="font-size: 12px; line-height: 1.6; color: #a1a1aa; margin: 24px 0 0;">
        If you didn't request this, you can safely ignore this email.
      </p>
    `),
  });
}

// Primary sign-in email (COMMENTS_V2.md §3). The code is the only thing above the
// fold — set large, monospaced and letter-spaced so it reads cleanly from a
// notification preview and is easy to re-type by hand.
//
// Deliberately no magic link in here. The reader is already on the page they
// signed in from, so a link would just re-open a second copy of it; the fallback
// for "code arrived on a different device" is /signin, linked below the code.
export async function sendOtpEmail(email: string, otp: string) {
  const { error } = await resend.emails.send({
    from: import.meta.env.EMAIL_FROM,
    to: email,
    subject: `${otp} is your sign-in code — umyar blog`,
    html: shell(`
      <h1 style="font-size: 20px; margin: 0 0 12px; color: #18181b;">Your sign-in code</h1>
      <p style="font-size: 14px; line-height: 1.6; color: #52525b; margin: 0 0 20px;">
        Type this back into the page you left open. It expires in 10 minutes.
      </p>
      <p style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 34px; font-weight: 700; letter-spacing: 0.28em; color: #18181b; margin: 0 0 20px; padding-left: 2px;">
        ${escapeHtml(otp)}
      </p>
      <p style="font-size: 13px; line-height: 1.6; color: #52525b; margin: 0 0 24px;">
        Closed the tab? Enter it at
        <a href="${canonicalUrl}/signin" style="color: #4a569d;">blog.umyar.com/signin</a>.
      </p>
      <p style="font-size: 12px; line-height: 1.6; color: #a1a1aa; margin: 0; border-top: 1px solid #e4e4e7; padding-top: 16px;">
        If you didn't try to sign in, ignore this email — the code is useless on its own and nobody can use it without your inbox.
      </p>
    `),
    text: `Your sign-in code for umyar — blog is ${otp}\n\nIt expires in 10 minutes. Type it back into the page you left open, or enter it at ${canonicalUrl}/signin\n\nIf you didn't try to sign in, ignore this email.`,
  });

  if (error) throw new Error(`Resend: ${error.message}`);
}

// Step 2 of double opt-in. Throws on a Resend error so /api/subscribe can avoid
// telling someone "check your inbox" when nothing was actually sent.
export async function sendSubscribeConfirmEmail(email: string, url: string) {
  const { error } = await resend.emails.send({
    from: import.meta.env.EMAIL_FROM,
    to: email,
    subject: 'Confirm your subscription — umyar blog',
    html: shell(`
      <h1 style="font-size: 20px; margin: 0 0 12px; color: #18181b;">One more click</h1>
      <p style="font-size: 14px; line-height: 1.6; color: #52525b; margin: 0 0 24px;">
        Confirm this address and you'll get an email whenever a new post goes up. Nothing else — no digests, no forwarding to anyone. This link expires in 24 hours.
      </p>
      ${button(url, 'Confirm subscription')}
      <p style="font-size: 12px; line-height: 1.6; color: #a1a1aa; margin: 24px 0 0;">
        If you didn't ask to subscribe, ignore this email — without this confirmation you'll never hear from us again.
      </p>
    `),
    text: `Confirm your subscription to umyar — blog by opening this link (expires in 24 hours):\n\n${url}\n\nIf you didn't ask to subscribe, ignore this email.`,
  });

  if (error) throw new Error(`Resend: ${error.message}`);
}

export type NewPostRecipient = { email: string; unsubscribeToken: string };

export type NewPostEmail = {
  title: string;
  excerpt: string;
  url: string;
  coverUrl?: string;
  // Rendered as "Also in: RU · PT" under the button.
  otherLangs: { label: string; url: string }[];
};

export type BroadcastResult = { sent: number; failed: number; errors: string[] };

function newPostHtml(post: NewPostEmail, unsubscribeUrl: string): string {
  const cover = post.coverUrl
    ? `<img src="${post.coverUrl}" alt="" width="432" style="width: 100%; max-width: 432px; height: auto; border-radius: 12px; display: block; margin: 0 0 20px;" />`
    : '';

  const others = post.otherLangs.length
    ? `<p style="font-size: 13px; line-height: 1.6; color: #a1a1aa; margin: 20px 0 0;">
         Also in ${post.otherLangs
           .map((l) => `<a href="${l.url}" style="color: #4a569d;">${escapeHtml(l.label)}</a>`)
           .join(' · ')}
       </p>`
    : '';

  return shell(`
    ${cover}
    <p style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #a1a1aa; margin: 0 0 8px;">New post</p>
    <h1 style="font-size: 20px; line-height: 1.35; margin: 0 0 12px; color: #18181b;">${escapeHtml(post.title)}</h1>
    <p style="font-size: 14px; line-height: 1.6; color: #52525b; margin: 0 0 24px;">${escapeHtml(post.excerpt)}</p>
    ${button(post.url, 'Read the post')}
    ${others}
    <p style="font-size: 12px; line-height: 1.6; color: #a1a1aa; margin: 32px 0 0; border-top: 1px solid #e4e4e7; padding-top: 16px;">
      You're getting this because you confirmed your email on blog.umyar.com.
      <a href="${unsubscribeUrl}" style="color: #a1a1aa;">Unsubscribe</a>.
    </p>
  `);
}

function newPostText(post: NewPostEmail, unsubscribeUrl: string): string {
  const others = post.otherLangs.length
    ? `\n\nAlso in ${post.otherLangs.map((l) => `${l.label}: ${l.url}`).join(' · ')}`
    : '';
  return `New post — ${post.title}\n\n${post.excerpt}\n\nRead it: ${post.url}${others}\n\n---\nYou're getting this because you confirmed your email on blog.umyar.com.\nUnsubscribe: ${unsubscribeUrl}`;
}

// Announce a post to the confirmed list. Each recipient gets their own message so
// addresses are never exposed to each other and each carries its own unsubscribe
// link. Failures are counted rather than thrown: one bad chunk shouldn't abort a
// send that already reached most of the list.
export async function sendNewPostEmails(
  recipients: NewPostRecipient[],
  post: NewPostEmail,
  baseUrl: string
): Promise<BroadcastResult> {
  const result: BroadcastResult = { sent: 0, failed: 0, errors: [] };

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);

    const payload = chunk.map((r) => {
      const token = encodeURIComponent(r.unsubscribeToken);
      // Two different URLs on purpose. The visible link goes to a page with a
      // confirm button, because link-prefetching spam scanners follow hrefs and
      // would otherwise unsubscribe people silently. The header URL is the
      // immediate one — RFC 8058 requires a One-Click client to POST it, which
      // no prefetcher does.
      const pageUrl = `${baseUrl}/unsubscribe?token=${token}`;
      const oneClickUrl = `${baseUrl}/api/unsubscribe?token=${token}`;
      return {
        from: import.meta.env.EMAIL_FROM,
        to: r.email,
        subject: `New post — ${post.title}`,
        html: newPostHtml(post, pageUrl),
        text: newPostText(post, pageUrl),
        headers: {
          // Required by Gmail and Yahoo for bulk senders — without it, this
          // lands in spam regardless of how good the domain reputation is.
          'List-Unsubscribe': `<${oneClickUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      };
    });

    try {
      const { error } = await resend.batch.send(payload);
      if (error) {
        result.failed += chunk.length;
        result.errors.push(error.message);
      } else {
        result.sent += chunk.length;
      }
    } catch (err) {
      result.failed += chunk.length;
      result.errors.push(err instanceof Error ? err.message : String(err));
    }

    if (i + BATCH_SIZE < recipients.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
    }
  }

  return result;
}
