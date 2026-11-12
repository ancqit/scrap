/** Admin portal. Stays on the worker; signed keys never keep this prefix. */
export const ADMIN_PORTAL = "1001";

/** Slave portal. This is the number the Angular app is allowed to show. */
export const SLAVE_PORTAL = "2001";

const MAX_KEY_LENGTH = 512;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class KeyError extends Error {
  constructor(message = "invalid key") {
    super(message);
  }
}

/**
 * Object keys always live under the slave portal. A leading admin portal
 * segment is rewritten, so a signed URL cannot advertise 1001.
 */
export function toPublicObjectKey(raw: unknown): string {
  if (typeof raw !== "string") throw new KeyError("key must be a string");

  const trimmed = raw.trim().replaceAll("\\", "/");
  if (!trimmed || trimmed.includes("\0") || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    throw new KeyError("invalid key");
  }

  const segments = trimmed
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(decodeSegment);

  if (segments.length === 0 || segments.length > 16) throw new KeyError("invalid key");
  if (segments.some((segment) => segment === "." || segment === ".." || !SEGMENT.test(segment))) {
    throw new KeyError("invalid key");
  }

  if (segments[0] === ADMIN_PORTAL) segments[0] = SLAVE_PORTAL;
  else if (segments[0] !== SLAVE_PORTAL) segments.unshift(SLAVE_PORTAL);

  if (segments.length < 2 || segments.includes(ADMIN_PORTAL)) throw new KeyError("invalid key");

  const key = segments.join("/");
  if (key.length > MAX_KEY_LENGTH) throw new KeyError("key is too long");
  return key;
}

function decodeSegment(segment: string): string {
  if (!segment.includes("%")) return segment;
  try {
    const decoded = decodeURIComponent(segment);
    if (decoded.includes("%") || decoded.includes("/") || decoded.includes("\\")) {
      throw new Error("nested encoding");
    }
    return decoded;
  } catch (error) {
    if (error instanceof KeyError) throw error;
    throw new KeyError("invalid key");
  }
}
