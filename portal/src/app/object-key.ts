export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function isAllowedImage(contentType: string): boolean {
  return ALLOWED_TYPES.has(contentType);
}

/** Relative key. The worker prefixes the slave portal before it signs. */
export function scrapObjectKey(fileName: string, id: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? 'image';
  const clean = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `scraps/${id}-${clean || 'image'}`;
}
