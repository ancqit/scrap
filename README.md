# scrap

Angular portal for scraps, plus a Cloudflare Worker that signs R2 uploads. The browser talks to R2 directly. R2 credentials stay in Worker secrets and never go in the Angular bundle.

Two portal numbers:

| Role | Number | Where it lives |
| --- | --- | --- |
| Admin | 1001 | Worker only. A leading `1001/` key is rewritten before signing. |
| Slave | 2001 | The number the portal shows and stores. |

The portal field works like herbant: `2001` is a button, and clicking it fills the input. Upload stays disabled until that click. The admin number is not in `portal/src`.

`/admin` is the upload screen. It is not an access-controlled login. Set the Worker secret `UPLOAD_TOKEN` before a public deploy, and type that token into the admin form. It is not compiled into the app.

## Dashboard steps

These stay in the Cloudflare dashboard:

1. R2 → Create bucket. The Worker expects `scrap-images` (change `BUCKET` in `worker/wrangler.toml` if you pick another name). Lowercase and dashes only.
2. R2 → API tokens → Create API token, Object Read & Write, scoped to that bucket.
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

| Route | What it does |
| --- | --- |
| `POST /get-upload-url` | Body `{ key, contentType }`. Returns a one-hour presigned `PUT`. |
| `POST /get-download-url` | Presigned `GET`, or a CDN url when `visibility` is `public` and `PUBLIC_BASE_URL` is set. |
| `GET /health` | `{ ok, uploadProtected }`. |

Allowed image types: JPEG, PNG, WebP, GIF. Keys are forced under `2001/…`.

## Portal

```bash
cd portal
npm install
npm test
npm start
```

The dev server is `http://localhost:4200`. `portal/src/app/worker-url.ts` points at `http://127.0.0.1:8787` (wrangler dev). Change that constant to the deployed Worker origin before you ship the portal, and add the same origin to `ALLOWED_ORIGIN`.

Scrap titles and keys are kept in `localStorage` (`scrap.store.v1`). Image bytes go to R2. Removing a scrap in the admin screen deletes the browser record only.
