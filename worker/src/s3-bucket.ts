import { AwsClient } from "aws4fetch";
import type { Env, ScrapBucket, ScrapObject } from "./index";

/**
 * R2's S3 API, shaped like the Worker bucket binding.
 * The Vercel function uses this so the browser never has to call workers.dev.
 */
export function s3Bucket(env: Env, fetchImpl: typeof fetch = fetch): ScrapBucket {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });

  async function call(
    method: "GET" | "PUT" | "DELETE",
    key: string,
    body?: Uint8Array,
    contentType?: string,
    cacheControl?: string,
  ): Promise<Response> {
    const headers = new Headers();
    headers.set("x-amz-content-sha256", "UNSIGNED-PAYLOAD");
    if (contentType) headers.set("content-type", contentType);
    if (cacheControl) headers.set("cache-control", cacheControl);
    const signed = await client.sign(
      new Request(objectUrl(env, key), {
        method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
      }),
      { aws: { allHeaders: true } },
    );
    return fetchImpl(signed);
  }

  return {
    async put(key, value, options) {
      const response = await call(
        "PUT",
        key,
        await asBytes(value),
        options?.httpMetadata?.contentType,
        options?.httpMetadata?.cacheControl,
      );
      if (!response.ok) throw new Error(`R2 rejected the write (${response.status})`);
    },
    async get(key) {
      const response = await call("GET", key);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`R2 rejected the read (${response.status})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") ?? undefined;
      const object: ScrapObject = {
        body: new Response(bytes).body ?? new ReadableStream(),
        httpMetadata: contentType ? { contentType } : undefined,
        async json() {
          return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        },
      };
      return object;
    },
    async delete(key) {
      const response = await call("DELETE", key);
      if (!response.ok && response.status !== 404) {
        throw new Error(`R2 rejected the delete (${response.status})`);
      }
    },
  };
}

function objectUrl(env: Env, key: string): URL {
  const endpoint = (env.R2_ENDPOINT || `https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/$/, "");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/") {
    throw new Error("R2 rejected the endpoint");
  }
  const encoded = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  url.pathname = `/${env.BUCKET}/${encoded}`;
  return url;
}

async function asBytes(
  value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
): Promise<Uint8Array> {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  return new Uint8Array(await new Response(value).arrayBuffer());
}
