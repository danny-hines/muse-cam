import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  createEvent,
  logout,
  publishOriginal,
  toggleDevice,
  unsharePhoto,
} from "@/app/admin/actions";
import { CreateClaimForm } from "@/components/create-claim-form";
import { DeletePhotoForm } from "@/components/delete-photo-form";
import { DeviceEventForm, DeviceNameForm } from "@/components/device-event-form";
import { EventSettingsForm } from "@/components/event-settings-form";
import { getPreset } from "@/config/presets";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { syncConfiguredDevice } from "@/lib/device-auth";
import { getFleetRepository } from "@/lib/fleet";
import { getPhotoRepository } from "@/lib/repository";
import { fullTimestamp } from "@/lib/time";

type AdminPageProps = { searchParams: Promise<{ notice?: string }> };

export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: AdminPageProps) {
  if (!(await isAdminAuthenticated())) redirect("/admin/login");
  await syncConfiguredDevice();
  const [{ notice }, photos, devices, events, claims] = await Promise.all([
    searchParams,
    getPhotoRepository().listAll(100),
    getFleetRepository().listDevices(),
    getFleetRepository().listEvents(),
    getFleetRepository().listClaims(),
  ]);
  const eventOptions = events.map(({ id, name }) => ({ id, name }));
  const deviceNames = new Map(devices.map((device) => [device.id, device.name]));
  const eventNames = new Map(events.map((event) => [event.id, event.name]));

  return (
    <main className="admin-main">
      <header className="admin-header">
        <div>
          <p className="section-kicker">Operations</p>
          <h1>Muse Cam control room</h1>
        </div>
        <div className="admin-header-actions">
          <form action={logout}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </header>

      {notice ? <p className="admin-notice">{notice}</p> : null}
      <section className="admin-stats" aria-label="Fleet overview">
        <div>
          <strong>{devices.length}</strong>
          <span>Cameras</span>
        </div>
        <div>
          <strong>{events.length}</strong>
          <span>Events</span>
        </div>
        <div>
          <strong>{photos.filter((photo) => photo.sharedAt).length}</strong>
          <span>Public photos</span>
        </div>
        <div>
          <strong>{photos.length}</strong>
          <span>Total captures</span>
        </div>
      </section>

      <div className="admin-columns">
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <p className="section-kicker">Organize</p>
              <h2>Events</h2>
            </div>
          </div>
          <form action={createEvent} className="admin-form compact-form">
            <label>
              Name
              <input name="name" placeholder="Seattle launch" required />
            </label>
            <label>
              URL slug
              <input name="slug" placeholder="seattle-launch" />
            </label>
            <label className="check-label">
              <input name="autoShare" type="checkbox" />
              Automatically share new photos to the event gallery
            </label>
            <label className="check-label">
              <input name="publishOriginals" type="checkbox" />
              Allow before-and-after originals for this event
            </label>
            <button type="submit">Create event</button>
          </form>
          <p className="device-event-help">
            Auto-sharing is off by default. Changes apply to new uploads; existing photos keep their sharing status.
          </p>
          <div className="admin-list">
            {events.map((event) => (
              <div className="admin-list-row admin-event-row" key={event.id}>
                <div>
                  <strong>{event.name}</strong>
                  <Link className="text-button" href={`/${event.slug}`}>View gallery /{event.slug} →</Link>
                </div>
                <EventSettingsForm
                  key={`${event.id}:${event.autoShare}:${event.publishOriginals}`}
                  event={{ id: event.id, name: event.name, autoShare: event.autoShare, publishOriginals: event.publishOriginals }}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <p className="section-kicker">Provision</p>
              <h2>Cameras</h2>
            </div>
          </div>
          <CreateClaimForm events={eventOptions} />
          {devices.length > 0 ? (
            <p className="device-event-help">
              Every camera needs an event. Changes apply to new uploads; existing photos keep their event.
            </p>
          ) : null}
          <div className="admin-list">
            {devices.map((device) => (
              <div className="admin-list-row admin-device-row" key={device.id}>
                <div>
                  <strong>{device.name}</strong>
                  {device.eventId ? null : (
                    <span className="device-unassigned">Uploads paused until assigned to an event</span>
                  )}
                </div>
                <form action={toggleDevice}>
                  <input type="hidden" name="id" value={device.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={device.status === "active" ? "revoked" : "active"}
                  />
                  <button className="text-button" type="submit">
                    {device.status === "active" ? "Revoke" : "Restore"}
                  </button>
                </form>
                <DeviceNameForm key={`${device.id}:${device.name}`} device={{ id: device.id, name: device.name }} />
                <DeviceEventForm
                  key={`${device.id}:${device.eventId ?? ""}`}
                  device={{ id: device.id, name: device.name, eventId: device.eventId }}
                  events={eventOptions}
                />
              </div>
            ))}
            {devices.length === 0 ? <p className="admin-empty">No registered cameras yet.</p> : null}
          </div>
          <p className="claim-history">
            {claims.filter((item) => !item.claimedAt && item.expiresAt > new Date()).length}{" "}
            active setup codes
          </p>
        </section>
      </div>

      <section className="admin-panel photo-admin-panel">
        <div className="admin-panel-heading">
          <div>
            <p className="section-kicker">Moderate</p>
            <h2>Recent captures</h2>
          </div>
          <span>{photos.length} loaded</span>
        </div>
        <div className="admin-photo-list">
          {photos.map((photo) => {
            const preset = getPreset(photo.presetId);
            const preview = photo.resultPrivateRef
              ? `/api/admin/photos/${photo.id}/image`
              : null;
            return (
              <article className="admin-photo-row" key={photo.id}>
                <div className="admin-thumb">
                  {preview ? (
                    <Image src={preview} alt="" fill sizes="112px" unoptimized />
                  ) : (
                    <span>No preview</span>
                  )}
                </div>
                <div className="admin-photo-copy">
                  <strong>{preset?.name ?? photo.presetId}</strong>
                  <span>{eventNames.get(photo.eventId) ?? photo.eventId}</span>
                  <span>{deviceNames.get(photo.deviceId) ?? photo.deviceId}</span>
                  <span>{fullTimestamp(photo.capturedAtDevice ?? photo.createdAt)}</span>
                </div>
                <div className="admin-photo-status">
                  <span className={`status-pill status-${photo.status}`}>{photo.status}</span>
                  {photo.sharedAt ? <span>Public</span> : <span>Private</span>}
                </div>
                <div className="admin-photo-actions">
                  {photo.publicSlug ? <Link href={`/p/${photo.publicSlug}`}>Open</Link> : null}
                  {photo.resultPublicUrl ? (
                    <form action={unsharePhoto}>
                      <input type="hidden" name="id" value={photo.id} />
                      <button type="submit">Hide</button>
                    </form>
                  ) : null}
                  {photo.resultPublicUrl && photo.originalPrivateRef && !photo.originalPublicUrl ? (
                    <form action={publishOriginal}>
                      <input type="hidden" name="id" value={photo.id} />
                      <button type="submit">Enable original</button>
                    </form>
                  ) : null}
                  <DeletePhotoForm id={photo.id} />
                </div>
              </article>
            );
          })}
          {photos.length === 0 ? <p className="admin-empty">No captures yet.</p> : null}
        </div>
      </section>
    </main>
  );
}
