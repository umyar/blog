// Behaviour for AvatarField.astro. Lives in lib/ rather than in the component so
// the sign-in dialog and /profile share one implementation — they can both be on
// the page at once, so everything here is scoped to a root element instead of ids.
import { avatarSrc } from './avatar';

const TARGET_PX = 256;
const QUALITY = 0.85;

/**
 * Re-encode any picked image to a square WebP through a canvas.
 *
 * The point isn't only size. Round-tripping through canvas means the bytes we
 * upload are ours: EXIF (including GPS) is dropped, the format is normalised to
 * one the server accepts, and no untrusted image parser ever runs server-side.
 */
async function toSquareWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = TARGET_PX;
    canvas.height = TARGET_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');

    // Cover-crop: fill the square, centre what overflows.
    const scale = Math.max(TARGET_PX / bitmap.width, TARGET_PX / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (TARGET_PX - w) / 2, (TARGET_PX - h) / 2, w, h);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))),
        'image/webp',
        QUALITY
      );
    });
  } finally {
    bitmap.close();
  }
}

/** Previewing a pasted URL by loading it here keeps R4 intact: the server never fetches it. */
function canLoad(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

export type AvatarField = {
  /** '' means "no avatar" — a legitimate answer, not a missing value. */
  getUrl(): string;
  setIdentity(opts: { id: string; firstName?: string; lastName?: string; email?: string }): void;
};

export function initAvatarField(root: HTMLElement): AvatarField {
  const preview = root.querySelector<HTMLImageElement>('[data-avatar-preview]')!;
  const fileInput = root.querySelector<HTMLInputElement>('[data-avatar-file]')!;
  const pickBtn = root.querySelector<HTMLButtonElement>('[data-avatar-pick]')!;
  const removeBtn = root.querySelector<HTMLButtonElement>('[data-avatar-remove]')!;
  const urlInput = root.querySelector<HTMLInputElement>('[data-avatar-url]')!;
  const errorEl = root.querySelector<HTMLElement>('[data-avatar-error]')!;

  let identity = { id: 'anon', firstName: '', lastName: '', email: '' };
  let uploadedUrl = '';

  function fail(message: string) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }
  function clearError() {
    errorEl.classList.add('hidden');
  }

  function currentUrl(): string {
    return urlInput.value.trim() || uploadedUrl;
  }

  function paint(src?: string) {
    preview.src = src || avatarSrc({ ...identity, avatarUrl: currentUrl() });
    removeBtn.classList.toggle('hidden', !currentUrl());
  }

  pickBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // so picking the same file twice still fires
    if (!file) return;
    clearError();

    if (!file.type.startsWith('image/')) return fail('That file isn’t an image.');

    pickBtn.disabled = true;
    const previousLabel = pickBtn.textContent;
    pickBtn.textContent = 'Uploading…';
    try {
      const webp = await toSquareWebp(file);
      // Show the local result immediately — the round trip shouldn't gate feedback.
      const localPreview = URL.createObjectURL(webp);
      paint(localPreview);

      const body = new FormData();
      body.append('file', new File([webp], 'avatar.webp', { type: 'image/webp' }));
      const res = await fetch('/api/avatar', { method: 'POST', body });
      URL.revokeObjectURL(localPreview);

      if (!res.ok) {
        const reason = await res.json().catch(() => null);
        paint();
        fail(
          reason?.error === 'uploads_unconfigured'
            ? 'Photo uploads aren’t set up yet — paste an image URL instead.'
            : 'That upload didn’t go through. Try again, or paste a URL.'
        );
        return;
      }

      const { url } = await res.json();
      uploadedUrl = url;
      urlInput.value = '';
      paint();
    } catch {
      paint();
      fail('That image couldn’t be read. Try a different file.');
    } finally {
      pickBtn.disabled = false;
      pickBtn.textContent = previousLabel;
    }
  });

  urlInput.addEventListener('change', async () => {
    clearError();
    const url = urlInput.value.trim();
    if (!url) return paint();
    if (!/^https?:\/\//i.test(url)) return fail('Photo URL must start with http:// or https://');
    if (!(await canLoad(url))) return fail('That URL didn’t load as an image.');
    uploadedUrl = '';
    paint();
  });

  removeBtn.addEventListener('click', () => {
    clearError();
    urlInput.value = '';
    uploadedUrl = '';
    paint();
  });

  // Paint immediately: setIdentity() may never be called (a signed-out reader
  // reaching the profile step for the first time), and an <img> with no src
  // renders as a broken image.
  paint();

  return {
    getUrl: currentUrl,
    setIdentity(opts) {
      identity = {
        id: opts.id,
        firstName: opts.firstName ?? '',
        lastName: opts.lastName ?? '',
        email: opts.email ?? '',
      };
      paint();
    },
  };
}
