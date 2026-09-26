"use client";

import { useFormStatus } from "react-dom";

import { updateEventSettings } from "@/app/admin/actions";

type EventSettingsFormProps = {
  event: { id: string; name: string; autoShare: boolean; publishOriginals: boolean };
};

function SaveButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>;
}

export function EventSettingsForm({ event }: EventSettingsFormProps) {
  return (
    <form action={updateEventSettings} className="admin-form event-settings-form" aria-label={`Settings for ${event.name}`}>
      <input type="hidden" name="id" value={event.id} />
      <label className="check-label">
        <input name="autoShare" type="checkbox" defaultChecked={event.autoShare} />
        Automatically share new photos to the event gallery
      </label>
      <label className="check-label">
        <input name="publishOriginals" type="checkbox" defaultChecked={event.publishOriginals} />
        Include originals when sharing
      </label>
      <SaveButton />
    </form>
  );
}
