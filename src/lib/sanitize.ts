/** Strip control chars and HTML tags from user-submitted post content. */
export function sanitizeContent(raw: string): string {
  return raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars
    .replace(/<[^>]*>/g, '')                             // strip HTML tags
    .slice(0, 280)
    .trim();
}
