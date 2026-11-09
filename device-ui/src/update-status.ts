import type { DeviceJob, UpdateInfo } from "./types";

export const UPDATE_PROMPT = "Check for the latest camera improvements.";

/**
 * The line under "Software updates". An install in progress comes first, then a
 * check made on this visit, then how the last install ended. The camera keeps
 * that last result on disk, so it must not hide a newer check.
 */
export function updateStatus(
  job: DeviceJob | undefined,
  check: UpdateInfo | null,
): string {
  const install = job?.kind === "update" ? job : undefined;
  if (install?.phase === "running" && install.message) return install.message;
  if (check?.message) return check.message;
  if (install && install.phase !== "idle" && install.message) {
    return install.message;
  }
  return UPDATE_PROMPT;
}
