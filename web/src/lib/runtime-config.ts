import { configuredModelProvider } from "@/lib/model";
import { hasPersistentMediaStore } from "@/lib/media";
import { hasPersistentDatabase } from "@/lib/repository";

export function getRuntimeStatus() {
  const modelProvider = configuredModelProvider();
  const deviceAuthConfigured = Boolean(
    process.env.DEVICE_API_TOKEN || process.env.DEVICE_API_TOKEN_SHA256 || hasPersistentDatabase(),
  );
  const modelConfigured = modelProvider === "mock" || Boolean(process.env.META_API_KEY);

  const services = {
    database: hasPersistentDatabase() ? "neon" : "memory",
    media: hasPersistentMediaStore() ? "vercel-blob" : "memory",
    model: modelProvider,
    deviceAuth: deviceAuthConfigured,
    modelConfigured,
  } as const;

  const productionReady =
    services.database === "neon" &&
    services.media === "vercel-blob" &&
    services.deviceAuth &&
    services.modelConfigured;

  return { services, productionReady };
}

export function deviceApiIsAvailable(): boolean {
  if (process.env.VERCEL_ENV === "production") {
    return getRuntimeStatus().productionReady;
  }
  return Boolean(
    process.env.DEVICE_API_TOKEN ||
      process.env.DEVICE_API_TOKEN_SHA256 ||
      hasPersistentDatabase(),
  );
}
