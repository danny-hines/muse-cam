import { getRuntimeStatus } from "@/lib/runtime-config";

export function GET() {
  const runtime = getRuntimeStatus();
  return Response.json({
    status: runtime.productionReady ? "ready" : "setup-required",
    ...runtime,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "development",
  });
}
