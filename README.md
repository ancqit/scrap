# scrap

Angular portal for scraps, plus a Cloudflare Worker that signs R2 uploads. The browser talks to R2 directly. R2 credentials stay in Worker secrets and never go in the Angular bundle.

Two portal numbers:

| Role | Number | Where it lives |
| --- | --- | --- |
| Admin | 1001 | Worker only. A leading `1001/` key is rewritten before signing. |
| Slave | 2001 | The number the portal shows and stores. |

The slave page still fills `2001` from a click, the same gesture as herbant. The admin number is not in `portal/src`.

An entity logs in on `/admin`, then creates a scrap: a type (the dropdown starts with `bikes`, and the input accepts another type), a price, 3 pictures, and 1 to 5 documents. That scrap is the card on `2001`. Set the Worker secret `UPLOAD_TOKEN` before a public deploy and use it as the admin token. It is not compiled into the app.

## Dashboard steps

These stay in the Cloudflare dashboard:

1. The bucket is `scrap` (`BUCKET` in `worker/wrangler.toml`). Reuse that bucket; do not create a second one.
2. R2 → API tokens → Create an S3 API token, Object Read & Write, scoped to `scrap`. This is the same pair junctionBack stores as `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.
3. Bucket → Settings → CORS. Paste `worker/r2-cors.json`. Add your production origin to `AllowedOrigins` when you have one. `PUT` from the browser fails without this.
4. For production reads, attach a custom domain that is already on Cloudflare. Put that origin in `PUBLIC_BASE_URL`. Skip the `r2.dev` URL; it is rate-limited and not cached.

## Worker

```bash
cd worker
npm install
npm test
cp .dev.vars.example .dev.vars   # local secrets, not committed
npx wrangler dev
```

Deploy, then set secrets (do not put them in `wrangler.toml`):

```bash
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put UPLOAD_TOKEN
npx wrangler deploy
```

`ACCOUNT_ID` is already set in `wrangler.toml`. It is the R2 endpoint host, not a secret.

Signing follows junctionBack `r2_media.presign_put`: S3 `put_object`, region `auto`, signature `s3v4`, `ContentType` included. The JSON uses the same names (`object_key`, `upload_url`, `public_url`, `content_type`, `expires_in`).

| Route | What it does |
| --- | --- |
| `POST /admin/login` | Body `{ token }`. Matches `UPLOAD_TOKEN` when that secret is set. |
| `POST /get-upload-url` | Body `{ key, contentType, kind }`. `kind` is `picture` or `document`. Returns a one-hour presigned `PUT`. |
| `POST /scraps` | Body `{ type, price, pictures[3], documents[1..5] }`. Publishes the card. |
| `GET /scraps` | Cards for portal 2001. |
| `GET /scrap-types` | `{ types: ["bikes", ...] }`. |
| `GET /health` | `{ ok, uploadProtected, bucket, pictures, documents }`. |

Pictures: JPEG, PNG, WebP, GIF, three per scrap. Documents: those images or PDF, up to five. Keys are forced under `2001/…`.

## Portal

```bash
cd portal
npm install
npm test
npm start
```

The dev server is `http://localhost:4200`. `portal/src/app/worker-url.ts` points at `http://127.0.0.1:8787` (wrangler dev). Change that constant to the deployed Worker origin before you ship the portal, and add the same origin to `ALLOWED_ORIGIN`.

The worker keeps the catalog in memory for the current process and the portal mirrors it in `localStorage` (`scrap.store.v1`). Picture and document bytes go to the `scrap` bucket once the S3 token is set. Send that token when you have it; it belongs in `worker/.dev.vars` locally and in `wrangler secret put` for deploy, never in the Angular app.
