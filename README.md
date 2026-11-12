# scrap

Angular portal for scraps, plus a Cloudflare Worker that stores pictures, documents, and scrap cards in the existing R2 bucket `scrap`. The browser never receives R2 credentials.

Two portal numbers:

| Role | Number | Where it lives |
| --- | --- | --- |
| Admin | 1001 | Worker only. A leading `1001/` key is rewritten before signing. |
| Slave | 2001 | The number the portal shows and stores. |

The slave page still fills `2001` from a click, the same gesture as herbant. The admin number is not in `portal/src`.

An entity logs in on `/admin`, then creates a scrap: a type (the dropdown starts with `bikes`, and the input accepts another type), a price, 3 pictures, and 1 to 5 documents. That scrap is the card on `2001`. Set the Worker secret `UPLOAD_TOKEN` before a public deploy and use it as the admin token. It is not compiled into the app.

## Dashboard steps

The Worker already names the existing bucket. `worker/wrangler.toml` binds it as `SCRAP` with `bucket_name = "scrap"`. Deploy the Worker in the Cloudflare account that owns that bucket. Wrangler attaches `scrap`; it does not create another bucket.

An S3 API token is not required for this path. The admin browser sends each file to the Worker, and the Worker writes it into `scrap`. The same binding stores the card list at `2001/catalog.json`.

For production reads you can attach a custom domain that is already on Cloudflare and put that origin in `PUBLIC_BASE_URL`. Skip the `r2.dev` URL; it is rate-limited and not cached. `worker/r2-cors.json` is only for a direct browser PUT to R2, which this path does not use.

## Worker

```bash
cd worker
npm install
npm test
cp .dev.vars.example .dev.vars   # local secrets, not committed
npx wrangler dev
```

Deploy in the account that already has `scrap`:

```bash
npx wrangler secret put UPLOAD_TOKEN
npx wrangler deploy
```

`ACCOUNT_ID` is already set in `wrangler.toml`. It is the R2 endpoint host, not a secret. `UPLOAD_TOKEN` is the admin login. It is not an R2 key.

If you later want the browser to PUT straight to R2, set `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` and leave the `SCRAP` binding off. That path signs like junctionBack `r2_media.presign_put`: S3 `put_object`, region `auto`, signature `s3v4`, `ContentType` included. The JSON uses the same names (`object_key`, `upload_url`, `public_url`, `content_type`, `expires_in`). With the binding present, those URLs point at the Worker, which writes `scrap`.

| Route | What it does |
| --- | --- |
| `POST /admin/login` | Body `{ token }`. Matches `UPLOAD_TOKEN` when that secret is set. |
| `POST /get-upload-url` | Body `{ key, contentType, kind }`. `kind` is `picture` or `document`. Returns a `PUT` for the bound `scrap` bucket. |
| `POST /scraps` | Body `{ type, price, pictures[3], documents[1..5] }`. Publishes the card. |
| `GET /scraps` | Cards for portal 2001. |
| `GET /scrap-types` | `{ types: ["bikes", ...] }`. |
| `PUT /r2/<key>` | Writes one picture or document into the bound `scrap` bucket. |
| `GET /r2/<key>` | Reads that object back out of `scrap`. |
| `GET /health` | `{ ok, uploadProtected, bucket, storage, pictures, documents }`. `storage` is `bucket` when `scrap` is bound. |

Pictures: JPEG, PNG, WebP, GIF, three per scrap. Documents: those images or PDF, up to five. Keys are forced under `2001/…`.

## Portal

```bash
cd portal
npm install
npm test
npm start
```

The dev server is `http://localhost:4200`. `portal/src/app/worker-url.ts` points at `http://127.0.0.1:8787` (wrangler dev). Change that constant to the deployed Worker origin before you ship the portal, and add the same origin to `ALLOWED_ORIGIN`.

Picture and document bytes, and the scrap cards, are stored in the existing `scrap` bucket. The portal also mirrors the card list in `localStorage` (`scrap.store.v1`) so the 2001 page can render if the Worker is briefly unreachable. On Render, publish the Angular app as a static site. The Worker, deployed on Cloudflare, is what writes `scrap`. Change `portal/src/app/worker-url.ts` to that Worker origin before the Render build, and add the Render origin to `ALLOWED_ORIGIN`.
