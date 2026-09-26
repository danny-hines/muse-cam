"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { updateDeviceEvent } from "@/app/admin/actions";

type DeviceEventFormProps = {
  device: { id: string; name: string; eventId: string | null };
  events: Array<{ id: string; name: string }>;
};

function SaveButton({ changed }: { changed: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending || !changed}>
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

export function DeviceEventForm({ device, events }: DeviceEventFormProps) {
  const [eventId, setEventId] = useState(device.eventId ?? "");

  return (
    <form action={updateDeviceEvent} className="admin-form device-event-form">
      <input type="hidden" name="id" value={device.id} />
      <label>
        Event
        <select
          name="eventId"
          aria-label={`Event for ${device.name}`}
          value={eventId}
          onChange={(event) => setEventId(event.target.value)}
        >
          {device.eventId ? null : <option value="" disabled>Choose an event</option>}
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </select>
      </label>
      <SaveButton changed={eventId !== (device.eventId ?? "")} />
    </form>
  );
}
