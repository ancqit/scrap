import type { Env } from "./index";

const ACCOUNT_ID = "f1d24d5e867a3d29f557db38d7fe5aab";
const BUCKET = "junction-shorts";
const PUBLIC_BASE_URL = "https://media.junction.monster";

/** Env for the Vercel `/api` function. Secrets come from the project settings, never from the bundle. */
export function workerEnv(source: Record<string, string | undefined>): Env {
  const accessKeyId = source["R2_ACCESS_KEY_ID"] ?? "";
  const secretAccessKey = source["R2_SECRET_ACCESS_KEY"] ?? "";
  const env: Env = {
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    ACCOUNT_ID: source["ACCOUNT_ID"] || ACCOUNT_ID,
    BUCKET: source["BUCKET"] || BUCKET,
    ALLOWED_ORIGIN: source["ALLOWED_ORIGIN"] ?? "",
    PUBLIC_BASE_URL: source["PUBLIC_BASE_URL"] || PUBLIC_BASE_URL,
    UPLOAD_TOKEN: source["UPLOAD_TOKEN"] || undefined,
    R2_ENDPOINT: source["R2_ENDPOINT"] || undefined,
    REQUIRE_UPLOAD_TOKEN: true,
    S3_CATALOG: Boolean(accessKeyId && secretAccessKey),
  };
  return env;
}

/** The portal calls `/api/...`. The worker routes are `/...`. */
export function rewriteApiRequest(request: Request): Request {
  const url = new URL(request.url);
  const stripped = url.pathname.replace(/^\/api(?=\/|$)/, "");
  url.pathname = stripped === "" ? "/" : stripped;
  return new Request(url, request);
}
