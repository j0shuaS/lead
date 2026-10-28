export const clock = () => new Date().toLocaleTimeString([], { hour12: false });

export function shortLink(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    const s = u.hostname.replace(/^www\./, '') + path;
    return s.length > 38 ? s.slice(0, 37) + '…' : s;
  } catch {
    return url;
  }
}
