import { beforeEach, describe, expect, it } from "vitest";
import { clearCatalog } from "../src/catalog";
import worker, { type Env } from "../src/index";
import { rewriteApiRequest, workerEnv } from "../src/vercel-env";

const env: Env = {
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-value",
  ACCOUNT_ID: "f1d24d5e867a3d29f557db38d7fe5aab",
  BUCKET: "junction-shorts",
  ALLOWED_ORIGIN: "http://localhost:4200,http://127.0.0.1:4200",
};

function post(path: string, body: unknown, init?: { origin?: string; token?: string }): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (init?.origin) headers.set("origin", init.origin);
  if (init?.token) headers.set("authorization", `Bearer ${init.token}`);
  return new Request(`https://worker.test${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("presign worker", () => {
  beforeEach(() => {
    clearCatalog();
  });

  it("signs a PUT under the slave portal and hides the admin number", async () => {
    const response = await worker.fetch(
      post(
        "/get-upload-url",
        { key: "1001/scraps/photo.jpg", contentType: "image/jpeg" },
        { origin: "http://localhost:4200" },
      ),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:4200");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = (await response.json()) as {
      url: string;
      key: string;
      method: string;
      headers: Record<string, string>;
      expiresIn: number;
    };

    expect(body.key).toBe("2001/scraps/photo.jpg");
    expect(body.object_key).toBe(body.key);
    expect(body.upload_url).toBe(body.url);
    expect(body.upload_method).toBe("PUT");
    expect(body.kind).toBe("picture");
    expect(body.method).toBe("PUT");
    expect(body.expiresIn).toBe(3600);
    expect(body.headers["content-type"]).toBe("image/jpeg");
    expect(body.headers["x-amz-content-sha256"]).toBe("UNSIGNED-PAYLOAD");
    expect(body.headers["host"]).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("1001");
    expect(body.url).not.toContain(env.R2_SECRET_ACCESS_KEY);
    expect(body.url).toContain(env.R2_ACCESS_KEY_ID);

    const signed = new URL(body.url);
    expect(signed.host).toBe(`${env.ACCOUNT_ID}.r2.cloudflarestorage.com`);
    expect(signed.pathname).toBe(`/${env.BUCKET}/2001/scraps/photo.jpg`);
    expect(signed.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(signed.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(signed.searchParams.get("X-Amz-Credential")).toMatch(/\/auto\/s3\/aws4_request$/);
    expect(signed.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(signed.searchParams.get("X-Amz-Content-Sha256") ?? body.headers["x-amz-content-sha256"]).toBe(
      "UNSIGNED-PAYLOAD",
    );
    expect(signed.toString()).not.toContain(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("returns a CDN url for public reads when a custom domain is configured", async () => {
    const response = await worker.fetch(
      post("/get-download-url", { key: "scraps/photo.jpg", visibility: "public" }),
      { ...env, PUBLIC_BASE_URL: "https://images.example.com/bucket/" },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { url: string; key: string; via: string; signed: boolean };
    expect(body).toEqual({
      url: "https://images.example.com/bucket/2001/scraps/photo.jpg",
      key: "2001/scraps/photo.jpg",
      via: "cdn",
      signed: false,
    });
  });

  it("presigns a GET when the image is private", async () => {
    const response = await worker.fetch(post("/get-download-url", { key: "scraps/photo.jpg" }), env);
    const body = (await response.json()) as { url: string; via: string; key: string };
    expect(response.status).toBe(200);
    expect(body.via).toBe("presigned");
    expect(body.key).toBe("2001/scraps/photo.jpg");
    expect(new URL(body.url).searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("rejects browser origins that are not the Angular app", async () => {
    const response = await worker.fetch(
      post("/get-upload-url", { key: "scraps/a.jpg", contentType: "image/png" }, { origin: "https://evil.example" }),
      env,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows a Vercel portal origin", async () => {
    const response = await worker.fetch(
      post("/get-upload-url", { key: "scraps/a.jpg", contentType: "image/png" }, { origin: "https://scrap.vercel.app" }),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://scrap.vercel.app");
  });

  it("answers CORS preflight for the portal origin", async () => {
    const response = await worker.fetch(
      new Request("https://worker.test/get-upload-url", {
        method: "OPTIONS",
        headers: { origin: "http://127.0.0.1:4200" },
      }),
      env,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:4200");
    expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("requires the upload token only when the secret is set", async () => {
    const open = await worker.fetch(
      post("/get-upload-url", { key: "scraps/a.jpg", contentType: "image/webp" }),
      env,
    );
    expect(open.status).toBe(200);

    const protectedEnv = { ...env, UPLOAD_TOKEN: "desk-token" };
    const missing = await worker.fetch(
      post("/get-upload-url", { key: "scraps/a.jpg", contentType: "image/webp" }),
      protectedEnv,
    );
    expect(missing.status).toBe(401);

    const wrong = await worker.fetch(
      post("/get-upload-url", { key: "scraps/a.jpg", contentType: "image/webp" }, { token: "nope" }),
      protectedEnv,
    );
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "Upload token is required" });

    const ok = await worker.fetch(
      post("/get-upload-url", { key: "scraps/a.jpg", contentType: "image/webp" }, { token: "desk-token" }),
      protectedEnv,
    );
    expect(ok.status).toBe(200);
  });

  it("rejects types that are not images", async () => {
    const response = await worker.fetch(
      post("/get-upload-url", { key: "scraps/a.svg", contentType: "image/svg+xml" }),
      env,
    );
    expect(response.status).toBe(400);
  });

  it("reports whether uploads are protected", async () => {
    const open = await worker.fetch(new Request("https://worker.test/health"), env);
    expect(await open.json()).toEqual({
      ok: true,
      uploadProtected: false,
      bucket: "junction-shorts",
      storage: "s3",
      pictures: 3,
      documents: 5,
    });

    const closed = await worker.fetch(new Request("https://worker.test/health"), {
      ...env,
      UPLOAD_TOKEN: "desk-token",
    });
    expect(await closed.json()).toMatchObject({ ok: true, uploadProtected: true });
  });

  it("logs the admin in and publishes a priced scrap for the slave portal", async () => {
    const denied = await worker.fetch(post("/admin/login", { token: "nope" }, {}), {
      ...env,
      UPLOAD_TOKEN: "desk-token",
    });
    expect(denied.status).toBe(401);

    const loggedIn = await worker.fetch(post("/admin/login", { token: "desk-token" }), {
      ...env,
      UPLOAD_TOKEN: "desk-token",
    });
    expect(loggedIn.status).toBe(200);
    expect(await loggedIn.json()).toEqual({ ok: true, role: "admin" });

    const slave = await worker.fetch(post("/admin/login", { token: "2001" }), {
      ...env,
      UPLOAD_TOKEN: "desk-token",
    });
    expect(await slave.json()).toEqual({ ok: true, role: "slave" });

    const open = await worker.fetch(post("/admin/login", { token: "anyone" }), env);
    expect(open.status).toBe(401);

    const created = await worker.fetch(
      post(
        "/scraps",
        {
          type: "bikes",
          price: 18500,
          pictures: [file("one.jpg"), file("two.jpg"), file("three.jpg")],
          documents: [file("rc.pdf", "application/pdf")],
        },
        { token: "desk-token" },
      ),
      { ...env, UPLOAD_TOKEN: "desk-token" },
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { scrap: { type: string; price: number; portal: string; pictures: unknown[] } };
    expect(body.scrap.type).toBe("bikes");
    expect(body.scrap.price).toBe(18500);
    expect(body.scrap.portal).toBe("2001");
    expect(body.scrap.pictures).toHaveLength(3);
    expect(JSON.stringify(body)).not.toContain("1001");

    const listed = await worker.fetch(new Request("https://worker.test/scraps"), {
      ...env,
      UPLOAD_TOKEN: "desk-token",
    });
    const catalog = (await listed.json()) as { scraps: { type: string; price: number }[] };
    expect(catalog.scraps.map((scrap) => scrap.type)).toContain("bikes");
    expect(catalog.scraps[0]?.price).toBe(18500);

    const types = await worker.fetch(new Request("https://worker.test/scrap-types"), env);
    expect(await types.json()).toEqual({ types: ["bikes"] });
  });

  it("writes pictures and the scrap card into the existing scrap bucket", async () => {
    const bucket = memoryBucket();
    const bound: Env = {
      ...env,
      SCRAP: bucket,
      R2_ACCESS_KEY_ID: "",
      R2_SECRET_ACCESS_KEY: "",
      UPLOAD_TOKEN: "desk-token",
    };

    const signed = await worker.fetch(
      post("/get-upload-url", { key: "scraps/one.jpg", contentType: "image/jpeg" }, { token: "desk-token" }),
      bound,
    );
    expect(signed.status).toBe(200);
    const upload = (await signed.json()) as { upload_url: string; via: string; object_key: string };
    expect(upload.via).toBe("bucket");
    expect(upload.object_key).toBe("2001/scraps/one.jpg");
    expect(upload.upload_url).toBe("https://worker.test/r2/2001/scraps/one.jpg");
    expect(JSON.stringify(upload)).not.toContain("1001");

    const denied = await worker.fetch(
      new Request(upload.upload_url, {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: new Uint8Array([1, 2, 3]),
      }),
      bound,
    );
    expect(denied.status).toBe(401);

    const put = await worker.fetch(
      new Request(upload.upload_url, {
        method: "PUT",
        headers: { "content-type": "image/jpeg", authorization: "Bearer desk-token" },
        body: new Uint8Array([1, 2, 3]),
      }),
      bound,
    );
    expect(put.status).toBe(200);

    const stored = await worker.fetch(new Request(upload.upload_url), bound);
    expect(stored.status).toBe(200);
    expect(stored.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const hidden = await worker.fetch(new Request("https://worker.test/r2/2001/catalog.json"), bound);
    expect(hidden.status).toBe(404);

    const created = await worker.fetch(
      post(
        "/scraps",
        {
          type: "bikes",
          price: 18500,
          pictures: [file("one.jpg"), file("two.jpg"), file("three.jpg")],
          documents: [file("rc.pdf", "application/pdf")],
        },
        { token: "desk-token" },
      ),
      bound,
    );
    expect(created.status).toBe(201);
    clearCatalog();

    const listed = await worker.fetch(new Request("https://worker.test/scraps"), bound);
    const catalog = (await listed.json()) as {
      scraps: { type: string; price: number; pictures: { url: string }[] }[];
    };
    expect(catalog.scraps[0]?.type).toBe("bikes");
    expect(catalog.scraps[0]?.price).toBe(18500);
    expect(catalog.scraps[0]?.pictures[0]?.url).toBe("https://worker.test/r2/2001/scraps/one.jpg");

    const health = await worker.fetch(new Request("https://worker.test/health"), bound);
    expect(await health.json()).toMatchObject({ bucket: "junction-shorts", storage: "bucket" });

    const onCdn = await worker.fetch(new Request("https://worker.test/scraps"), {
      ...bound,
      PUBLIC_BASE_URL: "https://media.junction.monster",
    });
    const cdn = (await onCdn.json()) as { scraps: { pictures: { url: string }[] }[] };
    expect(cdn.scraps[0]?.pictures[0]?.url).toBe("https://media.junction.monster/2001/scraps/one.jpg");
  });

  it("accepts a scrap that fills only one section", async () => {
    const pictures = await worker.fetch(
      post("/scraps", { type: "bikes", price: 10, pictures: [file("one.jpg")], documents: [] }),
      env,
    );
    expect(pictures.status).toBe(201);

    const documents = await worker.fetch(
      post("/scraps", {
        type: "bikes",
        price: 12,
        pictures: [],
        documents: [file("rc.pdf", "application/pdf")],
      }),
      env,
    );
    expect(documents.status).toBe(201);

    const empty = await worker.fetch(
      post("/scraps", { type: "bikes", price: 12, pictures: [], documents: [] }),
      env,
    );
    expect(empty.status).toBe(400);
  });

  it("deletes the scrap card and its files from the bucket", async () => {
    const bucket = memoryBucket();
    const bound: Env = { ...env, SCRAP: bucket, UPLOAD_TOKEN: "desk-token" };
    await bucket.put("2001/scraps/one.jpg", new Uint8Array([9, 9]), {
      httpMetadata: { contentType: "image/jpeg" },
    });

    const created = await worker.fetch(
      post("/scraps", { type: "bikes", price: 10, pictures: [file("one.jpg")], documents: [] }, { token: "desk-token" }),
      bound,
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { scrap: { id: string } };

    const removed = await worker.fetch(
      new Request(`https://worker.test/scraps/${body.scrap.id}`, {
        method: "DELETE",
        headers: { authorization: "Bearer desk-token" },
      }),
      bound,
    );
    expect(removed.status).toBe(204);

    const object = await worker.fetch(new Request("https://worker.test/r2/2001/scraps/one.jpg"), bound);
    expect(object.status).toBe(404);
    const listed = await worker.fetch(new Request("https://worker.test/scraps"), bound);
    expect(await listed.json()).toEqual({ scraps: [] });
  });

  it("serves /api on the same host and keeps the catalog in the bucket", async () => {
    const login = await worker.fetch(
      rewriteApiRequest(
        new Request("https://scrap.vercel.app/api/admin/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: "2001" }),
        }),
      ),
      workerEnv({}),
    );
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({ ok: true, role: "slave" });

    const missing = await worker.fetch(new Request("https://scrap.vercel.app/scraps"), workerEnv({}));
    expect(missing.status).toBe(500);
    expect(await missing.json()).toEqual({ error: "R2 credentials are not configured" });

    const objects = new Map<string, { data: Uint8Array; type: string }>();
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/junction-shorts\//, ""));
      if (request.method === "PUT") {
        objects.set(key, {
          data: new Uint8Array(await request.arrayBuffer()),
          type: request.headers.get("content-type") ?? "",
        });
        return new Response(null, { status: 200 });
      }
      if (request.method === "GET") {
        const hit = objects.get(key);
        if (!hit) return new Response("missing", { status: 404 });
        return new Response(hit.data, { status: 200, headers: { "content-type": hit.type } });
      }
      if (request.method === "DELETE") {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      return new Response("no", { status: 405 });
    };

    const bound = workerEnv({
      R2_ACCESS_KEY_ID: "test-access-key",
      R2_SECRET_ACCESS_KEY: "test-secret-value",
      UPLOAD_TOKEN: "desk-token",
    });
    bound.S3_FETCH = fetchImpl;

    const created = await worker.fetch(
      rewriteApiRequest(
        new Request("https://scrap.vercel.app/api/scraps", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer desk-token" },
          body: JSON.stringify({
            type: "bikes",
            price: 18500,
            pictures: [file("one.jpg")],
            documents: [],
          }),
        }),
      ),
      bound,
    );
    expect(created.status).toBe(201);
    clearCatalog();

    const listed = await worker.fetch(rewriteApiRequest(new Request("https://scrap.vercel.app/api/scraps")), bound);
    const catalog = (await listed.json()) as { scraps: { type: string; price: number; pictures: { url: string }[] }[] };
    expect(catalog.scraps[0]?.type).toBe("bikes");
    expect(catalog.scraps[0]?.price).toBe(18500);
    expect(catalog.scraps[0]?.pictures[0]?.url).toBe("https://media.junction.monster/2001/scraps/one.jpg");
    expect(objects.has("2001/catalog.json")).toBe(true);
  });
});

async function bytesOf(value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob): Promise<Uint8Array> {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  return new Uint8Array(await new Response(value).arrayBuffer());
}

function memoryBucket(): NonNullable<Env["SCRAP"]> {
  const objects = new Map<string, { data: Uint8Array; type: string }>();
  return {
    async put(key, value, options) {
      const data = await bytesOf(value);
      objects.set(key, { data, type: options?.httpMetadata?.contentType ?? "application/octet-stream" });
    },
    async get(key) {
      const hit = objects.get(key);
      if (!hit) return null;
      const data = hit.data;
      return {
        httpMetadata: { contentType: hit.type },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(data);
            controller.close();
          },
        }),
        json: async () => JSON.parse(new TextDecoder().decode(data)) as unknown,
      };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

function file(filename: string, contentType = "image/jpeg"): Record<string, string> {
  return {
    object_key: `scraps/${filename}`,
    content_type: contentType,
    filename,
  };
}
