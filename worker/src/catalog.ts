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

export function replaceCatalog(items: StoredScrap[]): void {
  scraps = items.map((item) => ({
    ...item,
    pictures: [...item.pictures],
    documents: [...item.documents],
  }));
}

export function isStoredScrap(value: unknown): value is StoredScrap {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["id"] === "string" &&
    typeof item["type"] === "string" &&
    typeof item["price"] === "number" &&
    item["currency"] === "INR" &&
    typeof item["createdAt"] === "string" &&
    Array.isArray(item["pictures"]) &&
    item["pictures"].every(isStoredFile) &&
    Array.isArray(item["documents"]) &&
    item["documents"].every(isStoredFile)
  );
}

function isStoredFile(value: unknown): value is ScrapFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Record<string, unknown>;
  return (
    typeof file["objectKey"] === "string" &&
    typeof file["contentType"] === "string" &&
    typeof file["filename"] === "string"
  );
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

export function takeScrap(id: string): StoredScrap | null {
  const found = scraps.find((scrap) => scrap.id === id) ?? null;
  if (!found) return null;
  scraps = scraps.filter((scrap) => scrap.id !== id);
  return found;
}

export function scrapFromBody(body: Record<string, unknown>): StoredScrap {
  const type = normalizeType(body["type"]);
  const price = normalizePrice(body["price"]);
  const pictures = parseFiles(body["pictures"] ?? [], 0, PICTURE_SLOTS, "pictures");
  const documents = parseFiles(body["documents"] ?? [], 0, DOCUMENT_SLOTS, "documents");
  if (pictures.length === 0 && documents.length === 0) {
    throw new CatalogError("Add scrap pictures or documents");
  }
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
  if (min === 0) return `A scrap can have at most ${max} ${label}`;
  if (min === max) return `A scrap needs ${min} ${label}`;
  return `A scrap needs ${min} to ${max} ${label}`;
}
