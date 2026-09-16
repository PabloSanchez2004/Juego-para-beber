/** Only web URLs returned by the server become clickable source links. */
export function sourceUrl(source: string): string | null {
  try {
    const url = new URL(source);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
