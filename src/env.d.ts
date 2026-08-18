/// <reference types="astro/client" />

// AuthDialog.astro renders once per page (from BaseLayout) and publishes itself
// here, so any island — the header, the comment composer, the like button — can
// ask for a signed-in reader without importing the dialog or duplicating its form.
//
// The promise resolves `true` only once the reader is signed in *and* their
// profile is complete, i.e. once they can actually comment; `false` if they
// dismissed it. That lets a caller do `if (await openAuthDialog()) retry()`.
interface AuthDialogOptions {
  /** Line shown above the form, e.g. "Sign in to post your comment." */
  reason?: string;
}

interface Window {
  openAuthDialog?: (opts?: AuthDialogOptions) => Promise<boolean>;
}
