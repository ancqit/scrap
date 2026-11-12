import { AwsClient } from "aws4fetch";
import {
  CatalogError,
  DOCUMENT_SLOTS,
  PICTURE_SLOTS,
  addScrap,
  listScraps,
  removeScrap,
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
}

const EXPIRES_SECONDS = 3600;
const MAX_BODY_CHARS = 16_384;

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
      { ok: true, uploadProtected: Boolean(env.UPLOAD_TOKEN), bucket: env.BUCKET, pictures: PICTURE_SLOTS, documents: DOCUMENT_SLOTS },
      200,
      origin,
    );
  }

  if (request.method === "GET" && path === "/scraps") return json(await publicCatalog(env), 200, origin);
  if (request.method === "GET" && path === "/scrap-types") {
    return json({ types: scrapTypes() }, 200, origin);
  }
  if (request.method === "DELETE" && path.startsWith("/scraps/")) {
    assertUploadToken(request, env);
    const id = decodeURIComponent(path.slice("/scraps/".length));
    if (!id || !removeScrap(id)) return json({ error: "Scrap not found" }, 404, origin);
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
  assertConfigured(env);
  assertUploadToken(request, env);
  const scrap = addScrap(scrapFromBody(await readJson(request)));
  return json({ scrap: await presentScrap(env, scrap) }, 201, origin);
}

async function publicCatalog(env: Env): Promise<{ scraps: Record<string, unknown>[] }> {
  assertConfigured(env);
  const scraps = await Promise.all(listScraps().map((scrap) => presentScrap(env, scrap)));
  return { scraps };
}

async function presentScrap(env: Env, scrap: StoredScrap): Promise<Record<string, unknown>> {
  return {
    id: scrap.id,
    type: scrap.type,
    price: scrap.price,
    currency: scrap.currency,
    portal: "2001",
    pictures: await Promise.all(scrap.pictures.map((file) => presentFile(env, file))),
    documents: await Promise.all(scrap.documents.map((file) => presentFile(env, file))),
    created_at: scrap.createdAt,
  };
}

async function presentFile(env: Env, file: ScrapFile): Promise<Record<string, unknown>> {
  const url = env.PUBLIC_BASE_URL
    ? cdnUrl(env.PUBLIC_BASE_URL, file.objectKey)
    : (await presign(env, "GET", file.objectKey)).url;
  return {
    object_key: file.objectKey,
    url,
    content_type: file.contentType,
    filename: file.filename,
  };
}

async function uploadUrl(request: Request, env: Env, origin: string | null): Promise<Response> {
  assertConfigured(env);
  assertUploadToken(request, env);

  const body = await readJson(request);
  const kind = body["kind"] === "document" ? "document" : "picture";
  const contentType = normalizeContentType(kind, body["contentType"] ?? body["content_type"]);
  const key = toPublicObjectKey(body["key"] ?? body["object_key"]);
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
  assertConfigured(env);
  const body = await readJson(request);
  const key = toPublicObjectKey(body["key"]);

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
  return list.includes(origin) ? origin : "deny";
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers();
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
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
