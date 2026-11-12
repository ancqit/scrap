import { toPublicObjectKey } from "./keys";

/** Picture slots on one scrap. */
export const PICTURE_SLOTS = 3;

/** Document slots on one scrap. */
export const DOCUMENT_SLOTS = 5;

/** First scrap type. The dropdown always offers this. */
export const SEED_TYPE = "bikes";

const TYPE_PATTERN = /^[\p{L}\p{N}]+(?:[ '\-][\p{L}\p{N}]+)*$/u;
const PICTURE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const DOCUMENT_TYPES = new Set([...PICTURE_TYPES, "application/pdf"]);

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface ScrapFile {
  objectKey: string;
  contentType: string;
  filename: string;
}

export interface StoredScrap {
  id: string;
  type: string;
  price: number;
  currency: "INR";
  pictures: ScrapFile[];
  documents: ScrapFile[];
  createdAt: string;
}

let scraps: StoredScrap[] = [];

export function clearCatalog(): void {
  scraps = [];
}

export function listScraps(): StoredScrap[] {
  return scraps;
}

export function scrapTypes(): string[] {
  const extras = scraps.map((scrap) => scrap.type).filter((type) => type !== SEED_TYPE);
  return [SEED_TYPE, ...new Set(extras)];
}

export function addScrap(scrap: StoredScrap): StoredScrap {
  scraps = [scrap, ...scraps.filter((item) => item.id !== scrap.id)];
  return scrap;
}

export function removeScrap(id: string): boolean {
  const next = scraps.filter((scrap) => scrap.id !== id);
  const removed = next.length !== scraps.length;
  scraps = next;
  return removed;
}

export function scrapFromBody(body: Record<string, unknown>): StoredScrap {
  const type = normalizeType(body["type"]);
  const price = normalizePrice(body["price"]);
  const pictures = parseFiles(body["pictures"], PICTURE_SLOTS, PICTURE_SLOTS, "pictures");
  const documents = parseFiles(body["documents"], 1, DOCUMENT_SLOTS, "documents");
  return {
    id: crypto.randomUUID(),
    type,
    price,
    currency: "INR",
    pictures,
    documents,
    createdAt: new Date().toISOString(),
  };
}

export function normalizeType(raw: unknown): string {
  if (typeof raw !== "string") throw new CatalogError("Scrap type is required");
  const type = raw.trim().replace(/\s+/g, " ");
  if (type.length < 2 || type.length > 40 || !TYPE_PATTERN.test(type)) {
    throw new CatalogError("Scrap type must be a short name such as bikes");
  }
  return type;
}

function normalizePrice(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 100_000_000) {
    throw new CatalogError("Price must be a number from 0 up");
  }
  return Math.round(raw * 100) / 100;
}

function parseFiles(raw: unknown, min: number, max: number, label: string): ScrapFile[] {
  if (!Array.isArray(raw)) throw new CatalogError(`${label} must be a list`);
  if (raw.length < min || raw.length > max) {
    throw new CatalogError(slotMessage(label, min, max));
  }
  return raw.map((entry) => parseFile(entry, label));
}

function parseFile(raw: unknown, label: string): ScrapFile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CatalogError("Each file needs an object key");
  }
  const record = raw as Record<string, unknown>;
  const objectKey = toPublicObjectKey(record["object_key"] ?? record["objectKey"] ?? record["key"]);
  const contentType = record["content_type"] ?? record["contentType"];
  const filename = record["filename"];
  if (typeof contentType !== "string" || !contentType.trim()) {
    throw new CatalogError("Each file needs a content type");
  }
  const normalized = contentType.trim().toLowerCase();
  const allowed = label === "documents" ? DOCUMENT_TYPES : PICTURE_TYPES;
  if (!allowed.has(normalized)) {
    throw new CatalogError(label === "documents" ? "A document must be a PDF or an image" : "A picture must be an image");
  }
  return {
    objectKey,
    contentType: normalized,
    filename: sanitizeFilename(typeof filename === "string" ? filename : "file"),
  };
}

function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "file";
  const clean = base.trim().replace(/[^\w.\- ]+/g, "").slice(0, 80);
  return clean || "file";
}

function slotMessage(label: string, min: number, max: number): string {
  if (min === max) return `A scrap needs ${min} ${label}`;
  return `A scrap needs ${min} to ${max} ${label}`;
}
