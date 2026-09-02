"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  clearAdminSession,
  createAdminSession,
  isAdminAuthenticated,
  verifyAdminKey,
} from "@/lib/admin-auth";
import { sha256 } from "@/lib/device-auth";
import { getFleetRepository } from "@/lib/fleet";
import { getMediaStore } from "@/lib/media";
import { getPhotoRepository } from "@/lib/repository";

async function requireAdmin(): Promise<void> {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
}

function destination(message: string): string {
  return `/admin?notice=${encodeURIComponent(message)}`;
}

export async function login(formData: FormData): Promise<void> {
  const key = String(formData.get("key") ?? "");
  if (!verifyAdminKey(key)) redirect("/admin/login?error=1");
  await createAdminSession();
  redirect("/admin");
}

export async function logout(): Promise<void> {
  await clearAdminSession();
  redirect("/admin/login");
}

export async function createEvent(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().slice(0, 100);
  const requestedSlug = String(formData.get("slug") ?? name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  if (!name || !requestedSlug) redirect(destination("Event name is required"));
  await getFleetRepository().createEvent({
    id: randomUUID(),
    name,
    slug: requestedSlug,
    publishOriginals: formData.get("publishOriginals") === "on",
  });
  revalidatePath("/admin");
  redirect(destination(`Created ${name}`));
}

const CLAIM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function claimCode(): string {
  const bytes = randomBytes(16);
  const characters = [...bytes].map((byte) => CLAIM_ALPHABET[byte % CLAIM_ALPHABET.length]);
  return Array.from({ length: 4 }, (_, index) => characters.slice(index * 4, index * 4 + 4).join(""))
    .join("-");
}

export type ClaimActionState = { code: string | null; error: string | null };

export async function createClaim(
  _previous: ClaimActionState,
  formData: FormData,
): Promise<ClaimActionState> {
  await requireAdmin();
  const code = claimCode();
  const eventId = String(formData.get("eventId") ?? "") || null;
  const suggestedName = String(formData.get("name") ?? "").trim().slice(0, 80) || null;
  await getFleetRepository().createClaim({
    id: randomUUID(),
    codeHash: sha256(code.replaceAll("-", "")),
    suggestedName,
    eventId,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });
  revalidatePath("/admin");
  return { code, error: null };
}

export async function toggleDevice(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = formData.get("status") === "revoked" ? "revoked" : "active";
  await getFleetRepository().updateDeviceStatus(id, status);
  revalidatePath("/admin");
  redirect(destination(status === "revoked" ? "Device revoked" : "Device restored"));
}

export async function unsharePhoto(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const repository = getPhotoRepository();
  const photo = await repository.findById(id);
  if (!photo) redirect(destination("Photo not found"));
  const media = getMediaStore();
  await Promise.all([
    photo.resultPublicUrl ? media.removePublic(photo.resultPublicUrl) : Promise.resolve(),
    photo.originalPublicUrl ? media.removePublic(photo.originalPublicUrl) : Promise.resolve(),
  ]);
  await repository.markUnshared(id);
  revalidatePath("/");
  revalidatePath("/admin");
  if (photo.publicSlug) revalidatePath(`/p/${photo.publicSlug}`);
  redirect(destination("Photo removed from the public roll"));
}

export async function publishOriginal(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const repository = getPhotoRepository();
  const photo = await repository.findById(id);
  if (!photo?.publicSlug || !photo.resultPublicUrl || !photo.originalPrivateRef) {
    redirect(destination("Share the transformed photo before publishing its original"));
  }
  if (!photo.originalPublicUrl) {
    const originalUrl = await getMediaStore().publish(
      photo.originalPrivateRef,
      `${photo.id}-original`,
      "image/jpeg",
    );
    await repository.markOriginalPublished(photo.id, originalUrl);
  }
  revalidatePath(`/p/${photo.publicSlug}`);
  revalidatePath("/admin");
  redirect(destination("Original enabled for before-and-after view"));
}

export async function deletePhoto(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const repository = getPhotoRepository();
  const photo = await repository.findById(id);
  if (!photo) redirect(destination("Photo not found"));
  const media = getMediaStore();
  for (const ref of [photo.resultPublicUrl, photo.originalPublicUrl]) {
    if (ref) await media.removePublic(ref);
  }
  for (const ref of [photo.resultPrivateRef, photo.originalPrivateRef]) {
    if (ref) await media.removePrivate(ref);
  }
  await repository.delete(id);
  revalidatePath("/");
  revalidatePath("/admin");
  if (photo.publicSlug) revalidatePath(`/p/${photo.publicSlug}`);
  redirect(destination("Photo and stored media permanently deleted"));
}
