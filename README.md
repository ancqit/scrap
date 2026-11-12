# scrap

Angular portal for scraps. Pictures, documents, and the card list are stored in junctionBack's R2 bucket `junction-shorts`. Public files are read from `https://media.junction.monster`. The browser never receives R2 credentials. junctionBack already has those credentials, and the portal calls that API.

There is one login. `2001` opens the read-only cards. `UPLOAD_TOKEN`, set on junctionBack next to the `R2_*` variables, opens the desk that can upload and delete. Any other value is rejected.

Scrap files are stored under `2001/`. junctionBack shorts stay under `shorts/`. The card list is `2001/catalog.json`.

## Portal

```bash
cd portal
npm install
npm test
npm start
```

The dev server is `http://localhost:4200`. The browser calls `/api` on that same host. `portal/proxy.conf.json` forwards `/api` to `https://junctionback.onrender.com`.

The Angular app deploys on Vercel the same way. `vercel.json` publishes `portal/dist/portal/browser`, sends `/api` to junctionBack, and falls back to `index.html` for Angular routes.

junctionBack needs the scrap routes in `junctionback/scrap.diff` before login will succeed. Apply that diff on junctionBack and set `UPLOAD_TOKEN` beside the existing R2 variables.
