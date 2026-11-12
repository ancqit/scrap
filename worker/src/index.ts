import { AwsClient } from "aws4fetch";
import { KeyError, toPublicObjectKey } from "./keys";

export interface Env {
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  ACCOUNT_ID: string;
  BUCKET: string;
  ALLOWED_ORIGIN: string;
  /** https origin of the bucket's custom domain. Public reads use this instead of a signed GET. */
  PUBLIC_BASE_URL?: string;
  /**
   * When set, POST /get-upload-url requires Authorization: Bearer <token>.
   * Leave unset only for local wrangler dev. Set it before a public deploy.
   */
  UPLOAD_TOKEN?: string;
}

const EXPIRES_SECONDS = 3600;
const MAX_BODY_CHARS = 4096;

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

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
      if (error instanceof KeyError) return json({ error: error.message }, 400, origin);
      console.error("presign failed");
      return json({ error: "Could not sign the request" }, 500, origin);
    }
  },
};

async function route(request: Request, env: Env, origin: string | null): Promise<Response> {
  const path = normalizePath(new URL(request.url).pathname);

  if (request.method === "GET" && (path === "/" || path === "/health")) {
    return json({ ok: true, uploadProtected: Boolean(env.UPLOAD_TOKEN) }, 200, origin);
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, origin, { allow: "GET, POST, OPTIONS" });
  }

  if (path === "/get-upload-url") return uploadUrl(request, env, origin);
  if (path === "/get-download-url") return downloadUrl(request, env, origin);
  return json({ error: "Not found" }, 404, origin);
}

async function uploadUrl(request: Request, env: Env, origin: string | null): Promise<Response> {
  assertConfigured(env);
  assertUploadToken(request, env);

  const body = await readJson(request);
  const contentType = body["contentType"];
  if (typeof contentType !== "string" || !ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new HttpError(400, "contentType must be image/jpeg, image/png, image/webp, or image/gif");
  }

  const key = toPublicObjectKey(body["key"]);
  const signed = await presign(env, "PUT", key, contentType);
  return json(
    {
      url: signed.url,
      key,
      method: "PUT",
      headers: signed.headers,
      expiresIn: EXPIRES_SECONDS,
    },
    200,
    origin,
  );
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
  const url = new URL(`https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com`);
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
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
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
