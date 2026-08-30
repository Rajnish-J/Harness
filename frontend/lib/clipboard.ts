/**
 * Write text to the clipboard, reporting whether it landed.
 *
 * `navigator.clipboard` is undefined outside a secure context — which, served
 * over http:// on a LAN address, is every time — so reaching for `.writeText`
 * throws rather than rejecting. Both failures collapse to `false` here, and
 * callers decide how loudly to say so: a toast where the copy was the whole
 * point, a silent no-op where it was a convenience.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
