import worker from "../worker/src/index";
import { rewriteApiRequest, workerEnv } from "../worker/src/vercel-env";

async function handle(request: Request): Promise<Response> {
  return worker.fetch(rewriteApiRequest(request), workerEnv(process.env));
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
