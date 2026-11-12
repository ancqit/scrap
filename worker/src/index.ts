import { AwsClient } from "aws4fetch";
import {
  CatalogError,
  DOCUMENT_SLOTS,
  PICTURE_SLOTS,
  addScrap,
  isStoredScrap,
  listScraps,
  takeScrap,
  replaceCatalog,
  scrapFromBody,
  scrapTypes,
  type ScrapFile,
  type StoredScrap,
} from "./catalog";
import { KeyError, toPublicObjectKey } from "./keys";

export interface Env {
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  ACCOUNT_ID: string;
  BUCKET: string;
  ALLOWED_ORIGIN: string;
  /** https origin of the bucket's custom domain. Public reads use this instead of a signed GET. */
  PUBLIC_BASE_URL?: string;
  /** S3 endpoint. Defaults to https://<ACCOUNT_ID>.r2.cloudflarestorage.com. */
  R2_ENDPOINT?: string;
  /**
   * When set, POST /get-upload-url requires Authorization: Bearer <token>.
   * Leave unset only for local wrangler dev. Set it before a public deploy.
   */
  UPLOAD_TOKEN?: string;
  /** junctionBack's R2 bucket, `junction-shorts`. Writes and reads go here when the binding is present. */
  SCRAP?: ScrapBucket;
}

export interface ScrapBucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<ScrapObject | null>;
  delete(key: string): Promise<void>;
}

export interface ScrapObject {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  json(): Promise<unknown>;
}

const EXPIRES_SECONDS = 3600;
const MAX_BODY_CHARS = 16_384;
const PICTURE_BYTES = 5 * 1024 * 1024;
const DOCUMENT_BYTES = 10 * 1024 * 1024;
const CATALOG_KEY = "2001/catalog.json";

const PICTURE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const DOCUMENT_TYPES = new Set([...PICTURE_TYPES, "application/pdf"]);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = resolveOrigin(request, env.ALLOWED_ORIGIN ?? "");
    if (origin === "deny") {
      return json({ error: "Origin is not allowed" }, 403, null);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      return await route(request, env, origin);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status, origin);
      if (error instanceof KeyError || error instanceof CatalogError) {
        return json({ error: error.message }, 400, origin);
      }
      console.error("presign failed");
      return json({ error: "Could not sign the request" }, 500, origin);
    }
  },
};

async function route(request: Request, env: Env, origin: string | null): Promise<Response> {
  const path = normalizePath(new URL(request.url).pathname);

  if (request.method === "GET" && (path === "/" || path === "/health")) {
    return json(
      {
        ok: true,
        uploadProtected: Boolean(env.UPLOAD_TOKEN),
        bucket: env.BUCKET,
        storage: env.SCRAP ? "bucket" : "s3",
        pictures: PICTURE_SLOTS,
        documents: DOCUMENT_SLOTS,
      },
      200,
      origin,
    );
  }

  if (path.startsWith("/r2/")) {
    if (request.method === "PUT") return writeObject(request, env, origin, path);
    if (request.method === "GET" || request.method === "HEAD") return readObject(request, env, origin, path);
    return json({ error: "Method not allowed" }, 405, origin, { allow: "GET, HEAD, PUT, OPTIONS" });
  }

  if (request.method === "GET" && path === "/scraps") return json(await publicCatalog(request, env), 200, origin);
  if (request.method === "GET" && path === "/scrap-types") {
    await hydrate(env);
    return json({ types: scrapTypes() }, 200, origin);
  }
  if (request.method === "DELETE" && path.startsWith("/scraps/")) {
    assertUploadToken(request, env);
    await hydrate(env);
    const id = decodeURIComponent(path.slice("/scraps/".length));
    const scrap = id ? takeScrap(id) : null;
    if (!scrap) return json({ error: "Scrap not found" }, 404, origin);
    await deleteStoredFiles(env, scrap);
    await persist(env);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, origin, { allow: "GET, POST, DELETE, OPTIONS" });
  }

  if (path === "/admin/login") return adminLogin(request, env, origin);
  if (path === "/get-upload-url") return uploadUrl(request, env, origin);
  if (path === "/get-download-url") return downloadUrl(request, env, origin);
  if (path === "/scraps") return createScrap(request, env, origin);
  return json({ error: "Not found" }, 404, origin);
}

async function adminLogin(request: Request, env: Env, origin: string | null): Promise<Response> {
  const body = await readJson(request);
  const token = typeof body["token"] === "string" ? body["token"].trim() : "";
  if (!token) throw new HttpError(400, "Admin token is required");
  if (env.UPLOAD_TOKEN && !safeEqual(token, env.UPLOAD_TOKEN)) {
    throw new HttpError(401, "Admin login failed");
  }
  return json({ ok: true }, 200, origin);
}

async function createScrap(request: Request, env: Env, origin: string | null): Promise<Response> {
  assertStorage(env);
  assertUploadToken(request, env);
  await hydrate(env);
  const scrap = addScrap(scrapFromBody(await readJson(request)));
  await persist(env);
  return json({ scrap: await presentScrap(env, request, scrap) }, 201, origin);
}

async function publicCatalog(request: Request, env: Env): Promise<{ scraps: Record<string, unknown>[] }> {
  assertStorage(env);
  await hydrate(env);
  const scraps = await Promise.all(listScraps().map((scrap) => presentScrap(env, request, scrap)));
  return { scraps };
}

async function presentScrap(env: Env, request: Request, scrap: StoredScrap): Promise<Record<string, unknown>> {
  return {
    id: scrap.id,
    type: scrap.type,
    price: scrap.price,
    currency: scrap.currency,
    portal: "2001",
    pictures: await Promise.all(scrap.pictures.map((file) => presentFile(env, request, file))),
    documents: await Promise.all(scrap.documents.map((file) => presentFile(env, request, file))),
    created_at: scrap.createdAt,
  };
}

async function presentFile(env: Env, request: Request, file: ScrapFile): Promise<Record<string, unknown>> {
  return {
    object_key: file.objectKey,
    url: await publicObjectUrl(env, request, file.objectKey),
    content_type: file.contentType,
    filename: file.filename,
  };
}

async function publicObjectUrl(env: Env, request: Request, key: string): Promise<string> {
  if (env.PUBLIC_BASE_URL) return cdnUrl(env.PUBLIC_BASE_URL, key);
  if (env.SCRAP) return `${workerOrigin(request)}/r2/${encodeKey(key)}`;
  return (await presign(env, "GET", key)).url;
}

async function uploadUrl(request: Request, env: Env, origin: string | null): Promise<Response> {
  assertStorage(env);
  assertUploadToken(request, env);

  const body = await readJson(request);
  const kind = body["kind"] === "document" ? "document" : "picture";
  const contentType = normalizeContentType(kind, body["contentType"] ?? body["content_type"]);
  const key = toPublicObjectKey(body["key"] ?? body["object_key"]);
  if (env.SCRAP) return bucketUpload(request, env, origin, key, contentType, kind);
  const signed = await presign(env, "PUT", key, contentType);
  const publicUrl = env.PUBLIC_BASE_URL ? cdnUrl(env.PUBLIC_BASE_URL, key) : "";
  return json(
    {
      object_key: key,
      upload_url: signed.url,
      public_url: publicUrl,
      content_type: contentType,
      expires_in: EXPIRES_SECONDS,
      kind,
      upload_method: "PUT",
      headers: signed.headers,
      url: signed.url,
      key,
      method: "PUT",
      expiresIn: EXPIRES_SECONDS,
    },
    200,
    origin,
  );
}

function bucketUpload(
  request: Request,
  env: Env,
  origin: string | null,
  key: string,
  contentType: string,
  kind: "picture" | "document",
): Response {
  const upload = `${workerOrigin(request)}/r2/${encodeKey(key)}`;
  const publicUrl = env.PUBLIC_BASE_URL ? cdnUrl(env.PUBLIC_BASE_URL, key) : upload;
  return json(
    {
      object_key: key,
      upload_url: upload,
      public_url: publicUrl,
      content_type: contentType,
      expires_in: EXPIRES_SECONDS,
      kind,
      upload_method: "PUT",
      headers: { "content-type": contentType },
      url: upload,
      key,
      method: "PUT",
      expiresIn: EXPIRES_SECONDS,
      via: "bucket",
    },
    200,
    origin,
  );
}

async function writeObject(request: Request, env: Env, origin: string | null, path: string): Promise<Response> {
  if (!env.SCRAP) throw new HttpError(404, "Object not found");
  assertUploadToken(request, env);
  const key = objectKeyFromPath(path);
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!DOCUMENT_TYPES.has(contentType)) {
    throw new HttpError(400, "Pictures must be JPEG, PNG, WebP, or GIF");
  }
  const bytes = await request.arrayBuffer();
  const limit = contentType === "application/pdf" ? DOCUMENT_BYTES : PICTURE_BYTES;
  if (bytes.byteLength === 0) throw new HttpError(400, "The file is empty");
  if (bytes.byteLength > limit) throw new HttpError(413, "The file is too large");
  await env.SCRAP.put(key, bytes, {
    httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
  });
  return new Response(null, { status: 200, headers: corsHeaders(origin) });
}

async function readObject(request: Request, env: Env, origin: string | null, path: string): Promise<Response> {
  if (!env.SCRAP) throw new HttpError(404, "Object not found");
  const key = objectKeyFromPath(path);
  const object = await env.SCRAP.get(key);
  if (!object) throw new HttpError(404, "Object not found");
  const headers = corsHeaders(origin);
  headers.set("content-type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("cache-control", "public, max-age=3600");
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(object.body, { status: 200, headers });
}

function objectKeyFromPath(path: string): string {
  let raw = path.slice("/r2/".length);
  try {
    raw = decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, "Object key is invalid");
  }
  const key = toPublicObjectKey(raw);
  if (key === CATALOG_KEY) throw new HttpError(404, "Object not found");
  return key;
}

async function hydrate(env: Env): Promise<void> {
  if (!env.SCRAP) return;
  const object = await env.SCRAP.get(CATALOG_KEY);
  if (!object) return;
  let parsed: unknown;
  try {
    parsed = await object.json();
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  replaceCatalog(parsed.filter(isStoredScrap));
}

async function deleteStoredFiles(env: Env, scrap: StoredScrap): Promise<void> {
  if (!env.SCRAP) return;
  const keys = [...scrap.pictures, ...scrap.documents].map((file) => file.objectKey);
  await Promise.all(keys.map((key) => env.SCRAP?.delete(key)));
}

async function persist(env: Env): Promise<void> {
  if (!env.SCRAP) return;
  await env.SCRAP.put(CATALOG_KEY, JSON.stringify(listScraps()), {
    httpMetadata: { contentType: "application/json", cacheControl: "no-store" },
  });
}

function workerOrigin(request: Request): string {
  return new URL(request.url).origin;
}

function normalizeContentType(kind: "picture" | "document", raw: unknown): string {
  if (typeof raw !== "string") {
    throw new HttpError(400, "contentType is required");
  }
  const contentType = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  const allowed = kind === "document" ? DOCUMENT_TYPES : PICTURE_TYPES;
  if (!allowed.has(contentType)) {
    throw new HttpError(
      400,
      kind === "document"
        ? "Documents must be PDF, JPEG, PNG, WebP, or GIF"
        : "Pictures must be JPEG, PNG, WebP, or GIF",
    );
  }
  return contentType;
}

async function downloadUrl(request: Request, env: Env, origin: string | null): Promise<Response> {
  assertStorage(env);
  const body = await readJson(request);
  const key = toPublicObjectKey(body["key"]);

  if (env.SCRAP && !(body["visibility"] === "public" && env.PUBLIC_BASE_URL)) {
    return json(
      {
        url: `${workerOrigin(request)}/r2/${encodeKey(key)}`,
        key,
        signed: false,
        via: "bucket",
        method: "GET",
      },
      200,
      origin,
    );
  }

  if (body["visibility"] === "public" && env.PUBLIC_BASE_URL) {
    return json({ url: cdnUrl(env.PUBLIC_BASE_URL, key), key, signed: false, via: "cdn" }, 200, origin);
  }

  const signed = await presign(env, "GET", key);
  return json(
    {
      url: signed.url,
      key,
      signed: true,
      via: "presigned",
      method: "GET",
      expiresIn: EXPIRES_SECONDS,
    },
    200,
    origin,
  );
}

function assertStorage(env: Env): void {
  if (env.SCRAP) {
    if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(env.BUCKET ?? "")) {
      throw new HttpError(500, "BUCKET is not configured");
    }
    return;
  }
  assertConfigured(env);
}

function assertConfigured(env: Env): void {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new HttpError(500, "R2 credentials are not configured");
  }
  if (!/^[a-f0-9]{32}$/.test(env.ACCOUNT_ID ?? "")) {
    throw new HttpError(500, "ACCOUNT_ID is not configured");
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(env.BUCKET ?? "")) {
    throw new HttpError(500, "BUCKET is not configured");
  }
}

function assertUploadToken(request: Request, env: Env): void {
  const expected = env.UPLOAD_TOKEN;
  if (!expected) return;

  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer (\S+)$/.exec(header);
  if (!match || !safeEqual(match[1] ?? "", expected)) {
    throw new HttpError(401, "Upload token is required");
  }
}

async function presign(
  env: Env,
  method: "GET" | "PUT",
  key: string,
  contentType?: string,
): Promise<{ url: string; headers: Record<string, string> }> {
  const url = objectUrl(env, key);
  url.searchParams.set("X-Amz-Expires", String(EXPIRES_SECONDS));

  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  // Browser uploads cannot reproduce a payload hash. R2 accepts the unsigned sentinel.
  headers.set("x-amz-content-sha256", "UNSIGNED-PAYLOAD");

  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });

  // allHeaders signs content-type. aws4fetch otherwise treats it as unsignable,
// which would let a client PUT a different type than the one we allowed.
const signed = await client.sign(new Request(url, { method, headers }), {
    aws: { signQuery: true, allHeaders: true },
  });

  return { url: signed.url, headers: clientHeaders(signed, contentType) };
}

function clientHeaders(signed: Request, contentType?: string): Record<string, string> {
  const signedNames = new URL(signed.url).searchParams.get("X-Amz-SignedHeaders") ?? "";
  const headers: Record<string, string> = {};
  for (const name of signedNames.split(";")) {
    if (!name || name === "host") continue;
    const value = signed.headers.get(name);
    if (value) headers[name] = value;
  }
  if (contentType) headers["content-type"] = contentType;
  return headers;
}

function objectUrl(env: Env, key: string): URL {
  const endpoint = (env.R2_ENDPOINT || `https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/$/, "");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/") {
    throw new HttpError(500, "R2_ENDPOINT is not configured");
  }
  url.pathname = `/${env.BUCKET}/${encodeKey(key)}`;
  return url;
}

function cdnUrl(base: string, key: string): string {
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new HttpError(500, "PUBLIC_BASE_URL is not configured");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search) {
    throw new HttpError(500, "PUBLIC_BASE_URL is not configured");
  }
  const prefix = parsed.pathname.replace(/\/$/, "");
  return `${parsed.origin}${prefix}/${encodeKey(key)}`;
}

function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) throw new HttpError(413, "Body is too large");

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Expected JSON body");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "Expected JSON object");
  }
  return data as Record<string, unknown>;
}

function resolveOrigin(request: Request, allowed: string): string | null | "deny" {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const list = allowed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.includes(origin)) return origin;
  // Preview and production hosts, same allowance junctionBack gives *.vercel.app.
  if (/^https:\/\/(?:[a-z0-9-]+\.)+vercel\.app$/.test(origin)) return origin;
  return "deny";
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers();
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  headers.set("access-control-allow-methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS");
  headers.set("access-control-allow-headers", "Content-Type, Authorization");
  headers.set("access-control-max-age", "86400");
  return headers;
}

function json(
  body: unknown,
  status: number,
  origin: string | null,
  extra?: Record<string, string>,
): Response {
  const headers = corsHeaders(origin);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  if (extra) {
    for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

function safeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
