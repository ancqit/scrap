export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const PICTURE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const DOCUMENT_TYPES = new Set([...PICTURE_TYPES, 'application/pdf']);

export function isAllowedImage(contentType: string): boolean {
  return PICTURE_TYPES.has(contentType);
}

export function isAllowedDocument(contentType: string): boolean {
  return DOCUMENT_TYPES.has(contentType);
}

/** Relative key. herback prefixes the slave portal before it signs. */
export function scrapFileKey(
  kind: 'pictures' | 'documents',
  slot: number,
  fileName: string,
  id: string,
): string {
  const base = fileName.split(/[/\\]/).pop() ?? 'file';
  const clean = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `scraps/${id}/${kind}/${slot}-${clean || 'file'}`;
}
