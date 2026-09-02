"use client";

import { useActionState } from "react";

import { createClaim, type ClaimActionState } from "@/app/admin/actions";

const INITIAL_STATE: ClaimActionState = { code: null, error: null };

type CreateClaimFormProps = {
  events: Array<{ id: string; name: string }>;
};

export function CreateClaimForm({ events }: CreateClaimFormProps) {
  const [state, action, pending] = useActionState(createClaim, INITIAL_STATE);

  return (
    <>
      <form action={action} className="admin-form compact-form">
        <label>
          Camera name
          <input name="name" placeholder="Muse Cam Seattle 01" />
        </label>
        <label>
          Event
          <select name="eventId" defaultValue="">
            <option value="">No event</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create setup code"}
        </button>
      </form>
      {state.code ? (
        <div className="claim-banner compact-claim">
          <div>
            <strong>One-time setup code</strong>
            <span>Expires in 30 minutes and disappears on refresh</span>
          </div>
          <code>{state.code}</code>
          <p>
            On the camera, run:{" "}
            <code>sudo /opt/muse-cam/.venv/bin/musecam claim {state.code}</code>
          </p>
        </div>
      ) : null}
    </>
  );
}
