import worker from "../worker/src/index";
import { rewriteApiRequest, workerEnv } from "../worker/src/vercel-env";

export const config = {
  api: {
    bodyParser: false,
  },
};

interface NodeRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array | string>;
}

interface NodeResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: Uint8Array): void;
}

async function handle(request: Request): Promise<Response> {
  const source = readEnv();
  return worker.fetch(rewriteApiRequest(request), workerEnv(source));
}

function readEnv(): Record<string, string | undefined> {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env ?? {};
}

async function fromNode(req: NodeRequest): Promise<Request> {
  const hostHeader = req.headers["host"];
  const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader) || "localhost";
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) || "https";
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }
  const method = req.method || "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(`${proto}://${host}${req.url || "/"}`, {
    method,
    headers,
    body: hasBody ? concatBytes(chunks) : undefined,
  });
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function writeNode(res: NodeResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key === "transfer-encoding" || key === "content-length") return;
    res.setHeader(key, value);
  });
  const payload = new Uint8Array(await response.arrayBuffer());
  res.setHeader("content-length", String(payload.byteLength));
  res.end(payload);
}

/** Vercel calls this for every method on /api/*. */
export default async function entry(req: Request | NodeRequest, res?: NodeResponse): Promise<Response | void> {
  if (res && "setHeader" in res && !(req instanceof Request)) {
    await writeNode(res, await handle(await fromNode(req)));
    return;
  }
  return handle(req as Request);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
