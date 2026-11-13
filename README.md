# scrap

Angular portal for scraps. Pictures, documents, and the card list are stored by herback in its R2 bucket. Public files are read from herback's `R2_PUBLIC_BASE_URL`. The browser never receives R2 credentials. herback holds the scrap routes, and the portal calls that API.

There is one login. `2001` opens the read-only cards. `UPLOAD_TOKEN`, set on herback next to the `R2_*` variables, opens the desk that can upload and delete. Any other value is rejected.

Scrap files are stored under `2001/`. herbant media stays under `herb/`. The card list is `2001/catalog.json`.

## Portal

```bash
cd portal
npm install
npm test
npm start
```

The dev server is `http://localhost:4200`. The browser calls `/api` on that same host. `portal/proxy.conf.json` forwards `/api` to `https://herback.onrender.com`.

The Angular app deploys on Vercel the same way. `vercel.json` publishes `portal/dist/portal/browser`, sends `/api` to herback, and falls back to `index.html` for Angular routes.

herback already serves `POST /scrap/login`, the upload URL, and the catalog. Set `UPLOAD_TOKEN` on that service beside the R2 variables. Login stays quiet until those are set.
