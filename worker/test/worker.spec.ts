import { beforeEach, describe, expect, it } from "vitest";
import { clearCatalog } from "../src/catalog";
import worker, { type Env } from "../src/index";

const env: Env = {
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-value",
  ACCOUNT_ID: "f1d24d5e867a3d29f557db38d7fe5aab",
  BUCKET: "scrap",
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
      bucket: "scrap",
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

  it("rejects a scrap that does not have 3 pictures", async () => {
    const response = await worker.fetch(
      post("/scraps", { type: "bikes", price: 10, pictures: [file("one.jpg")], documents: [file("rc.pdf", "application/pdf")] }),
      env,
    );
    expect(response.status).toBe(400);
  });
});

function file(filename: string, contentType = "image/jpeg"): Record<string, string> {
  return {
    object_key: `scraps/${filename}`,
    content_type: contentType,
    filename,
  };
}
