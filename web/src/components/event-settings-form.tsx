"use client";

import { useFormStatus } from "react-dom";

import { updateEventSettings } from "@/app/admin/actions";

export type StyleOption = { id: string; name: string; eventOnly: boolean };

type EventSettingsFormProps = {
  event: {
    id: string;
    name: string;
    autoShare: boolean;
    publishOriginals: boolean;
    presetIds: string[] | null;
    surpriseStyles: boolean;
  };
  styles: StyleOption[];
};

function SaveButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>;
}

function StyleGroup({ legend, styles, selected }: { legend: string; styles: StyleOption[]; selected: Set<string> }) {
  if (styles.length === 0) return null;
  return (
    <fieldset className="event-style-group">
      <legend>{legend}</legend>
      {styles.map((style) => (
        <label className="check-label" key={style.id}>
          <input name="presetIds" type="checkbox" value={style.id} defaultChecked={selected.has(style.id)} />
          {style.name}
        </label>
      ))}
    </fieldset>
  );
}

export function EventSettingsForm({ event, styles }: EventSettingsFormProps) {
  const eventOnly = styles.filter((style) => style.eventOnly);
  const standard = styles.filter((style) => !style.eventOnly);
  const selected = new Set(event.presetIds ?? standard.map((style) => style.id));
  const specials = eventOnly.filter((style) => selected.has(style.id)).length;
  const summary = event.presetIds
    ? `${selected.size} chosen${specials ? `, ${specials} event-only` : ""}`
    : "Default";

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
      <label>
        Who picks the style
        <select name="styleChoice" defaultValue={event.surpriseStyles ? "surprise" : "guest"}>
          <option value="guest">Guests pick on the camera</option>
          <option value="surprise">Surprise: the server picks for each photo</option>
        </select>
      </label>
      <details className="event-styles">
        <summary>Camera styles · {summary}</summary>
        <StyleGroup legend="Event-only" styles={eventOnly} selected={selected} />
        <StyleGroup legend="Default" styles={standard} selected={selected} />
        <p className="device-event-help">
          With Surprise, each photo gets a random style from this list, and a style the model
          refuses for a photo is swapped for another. Cameras load their styles when they
          start, so restart them after changing either setting.
        </p>
      </details>
      <SaveButton />
    </form>
  );
}
