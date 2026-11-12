# scrap

Angular portal for scraps, plus a Cloudflare Worker that stores pictures, documents, and scrap cards in the R2 bucket junctionBack already uses, `junction-shorts`. Public files are read from `https://media.junction.monster`. The browser never receives R2 credentials.

Two portal numbers:

| Role | Number | Where it lives |
| --- | --- | --- |
| Admin | 1001 | Worker only. A leading `1001/` key is rewritten before signing. |
| Slave | 2001 | The number the portal shows and stores. |

The slave page still fills `2001` from a click, the same gesture as herbant. The admin number is not in `portal/src`.

There is one login. `2001` opens the slave portal, which can see the cards. The Worker secret `UPLOAD_TOKEN` opens the admin desk, which can upload and delete. Any other value is rejected, including when that secret is unset. Set `UPLOAD_TOKEN` before a public deploy. It is not compiled into the app.

## Dashboard steps

junctionBack's bucket is `junction-shorts` (`R2_BUCKET` in that repo) and its public host is `https://media.junction.monster`. `worker/wrangler.toml` binds that same bucket as `SCRAP`. Deploy the Worker in the Cloudflare account that owns it. Wrangler attaches `junction-shorts`; it does not create a bucket.

Scrap files are stored under `2001/…`. junctionBack shorts stay under `shorts/…`, and the Worker rejects a scrap key that would land there. The card list is `2001/catalog.json` in the same bucket. Picture and document objects use the same long cache header junctionBack sets on shorts (`public, max-age=31536000, immutable`).

An S3 API token is not required for this path. The admin browser sends each file to the Worker, and the Worker writes it into `junction-shorts`. `worker/r2-cors.json` is only for a direct browser PUT to R2, which this path does not use.

## Worker

```bash
cd worker
npm install
npm test
cp .dev.vars.example .dev.vars   # local secrets, not committed
npx wrangler dev
```

Deploy in the account that already has `junction-shorts`:

```bash
npx wrangler secret put UPLOAD_TOKEN
npx wrangler deploy
```

`ACCOUNT_ID` is already set in `wrangler.toml`. It is the R2 endpoint host, not a secret. `UPLOAD_TOKEN` is the admin login. It is not an R2 key.

Those are the same R2 names junctionBack reads. With the binding present, uploads go to the Worker and the Worker writes `junction-shorts`. If you later want the browser to PUT straight to R2, set `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (the same pair as junctionBack) and leave the `SCRAP` binding off. That path signs like `r2_media.presign_put`: S3 `put_object`, region `auto`, signature `s3v4`, `ContentType` included. The JSON uses the same names (`object_key`, `upload_url`, `public_url`, `content_type`, `expires_in`).

| Route | What it does |
| --- | --- |
| `POST /admin/login` | Body `{ token }`. `2001` returns `{ role: "slave" }`. The `UPLOAD_TOKEN` value returns `{ role: "admin" }`. Anything else is rejected. |
| `POST /get-upload-url` | Body `{ key, contentType, kind }`. `kind` is `picture` or `document`. Returns a `PUT` into `junction-shorts`. |
| `POST /scraps` | Body `{ type, price, pictures[0..3], documents[0..5] }`. One of the two sections must contain a file. Uploads those files into the bucket. |
| `DELETE /scraps/:id` | Admin token. Deletes the card and its files from the bucket. |
| `GET /scraps` | Cards for portal 2001. |
| `GET /scrap-types` | `{ types: ["bikes", ...] }`. |
| `PUT /r2/<key>` | Writes one picture or document into `junction-shorts`. |
| `GET /r2/<key>` | Reads that object back. Public cards use `https://media.junction.monster` instead. |
| `GET /health` | `{ ok, uploadProtected, bucket, storage, pictures, documents }`. `bucket` is `junction-shorts`. |

The create form has a Scrap section (up to three JPEG, PNG, WebP, or GIF pictures) and a Documents section (up to five of those images, or PDF). Either section can be used on its own. Keys are forced under `2001/…` and cannot use the `shorts/` prefix. Deleting a scrap removes those objects from the bucket.

## Portal

```bash
cd portal
npm install
npm test
npm start
```

The dev server is `http://localhost:4200`. The browser calls `/api` on that same host. `portal/proxy.conf.json` forwards `/api` to wrangler at `http://127.0.0.1:8787`, so the page does not call `127.0.0.1` itself.

Picture and document bytes, and the scrap cards, are stored in `junction-shorts`. Card images load from `https://media.junction.monster/2001/…`. The portal also mirrors the card list in `localStorage` (`scrap.store.v1`) so the 2001 page can render if the Worker is briefly unreachable.

The Angular app deploys on Vercel. The build publishes `portal/dist/portal/browser` and an `/api` function together. Angular routes fall back to `index.html`. `/api` runs the same worker and writes to `junction-shorts` through the R2 S3 API. On the Vercel project, set `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` from the junctionBack Render environment, and set `UPLOAD_TOKEN` to the admin password. `https://*.vercel.app` may call that API.
