import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Look, Version } from "./types";
import { api } from "./use-camera";
import { Icon } from "./icons";
import {
  ADJUSTMENTS,
  adjusted,
  adjustment,
  colorMatrixValues,
  NO_ADJUSTMENTS,
  signed,
  type Adjustments,
} from "./edit-math";

// Edits the original, a styled version, or an Edited version. Editing an Edited
// version picks up its recipe, and Done updates it instead of adding another.
export function Editor({
  photoId,
  version,
  looks,
  onClose,
  onSaved,
}: {
  photoId: string;
  version: Version | null;
  looks: Look[];
  onClose: () => void;
  onSaved: (versionId: string) => void;
}) {
  const start = version?.edit ?? null;
  const target = version?.id ?? "original";
  const [tab, setTab] = useState<"looks" | "adjust">(
    start && !start.look && adjusted(start) ? "adjust" : "looks",
  );
  const [look, setLook] = useState<string | null>(start?.look ?? null);
  const [values, setValues] = useState<Adjustments>(
    start
      ? { light: start.light, contrast: start.contrast, color: start.color, warmth: start.warmth }
      : NO_ADJUSTMENTS,
  );
  const [comparing, setComparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // The camera renders looks; the screen adds the adjustments as a filter.
  const preview = (lookId: string | null, size: "thumb" | "screen") =>
    `/api/edit/${encodeURIComponent(photoId)}/preview?target=${encodeURIComponent(target)}` +
    `&look=${lookId ?? "none"}&size=${size}`;
  const wanted = preview(look, "screen");
  const before = preview(null, "screen");
  const [shown, setShown] = useState(wanted);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    // Keep the last look on screen until the next one arrives.
    let active = true;
    setLoading(true);
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      setShown(wanted);
      setLoading(false);
    };
    image.onerror = () => {
      if (!active) return;
      setLoading(false);
      setError("Couldn’t load the preview. Try again.");
    };
    image.src = wanted;
    return () => {
      active = false;
    };
  }, [wanted]);
  useEffect(() => {
    new Image().src = before;
  }, [before]);
  const { exponent, matrix } = useMemo(() => adjustment(values), [values]);
  const filtered = adjusted(values) && !comparing;
  const changed =
    look !== (start?.look ?? null) ||
    ADJUSTMENTS.some(({ key }) => values[key] !== (start?.[key] ?? 0));
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await api<{ versionId: string }>(
        `/api/edit/${encodeURIComponent(photoId)}`,
        { target: version?.id ?? null, look, ...values },
      );
      onSaved(result.versionId);
    } catch (problem) {
      setError((problem as Error).message);
      setSaving(false);
    }
  };
  const compare = (on: boolean) => setComparing(on && !saving);
  return (
    <section className="editor" role="dialog" aria-modal="true" aria-label="Edit photo">
      <svg className="filter-defs" aria-hidden="true" width="0" height="0">
        <filter id="edit-adjust" colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="gamma" amplitude="1" exponent={exponent} offset="0" />
            <feFuncG type="gamma" amplitude="1" exponent={exponent} offset="0" />
            <feFuncB type="gamma" amplitude="1" exponent={exponent} offset="0" />
          </feComponentTransfer>
          <feColorMatrix type="matrix" values={colorMatrixValues(matrix)} />
        </filter>
      </svg>
      <header className="editor-header">
        <button className="glass-button" disabled={saving} onClick={onClose}>
          Cancel
        </button>
        <div className="editor-title">
          <span className="eyebrow">{version?.presetName ?? "Original"}</span>
          <h1>Edit</h1>
        </div>
        <button
          className="primary-button"
          disabled={!changed || saving}
          onClick={() => void save()}
        >
          <Icon name="check" size={19} />
          {saving ? "Saving…" : "Done"}
        </button>
      </header>
      <div className="editor-body">
        <div
          className="editor-stage"
          role="img"
          aria-label="Edited photo. Hold to see it before editing."
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            compare(true);
          }}
          onPointerUp={() => compare(false)}
          onPointerCancel={() => compare(false)}
          onLostPointerCapture={() => compare(false)}
          onContextMenu={(event) => event.preventDefault()}
        >
          <img
            src={comparing ? before : shown}
            alt=""
            draggable={false}
            style={{ filter: filtered ? "url(#edit-adjust)" : "none" }}
          />
          <span className="editor-hint">
            {comparing ? "Before" : loading ? "Loading look…" : "Hold to compare"}
          </span>
        </div>
        <aside className="editor-panel">
          <nav className="editor-tabs" role="tablist" aria-label="Edit tools">
            {(
              [
                ["looks", "Looks", "look"],
                ["adjust", "Adjust", "settings"],
              ] as const
            ).map(([key, label, icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "selected" : ""}
                onClick={() => setTab(key)}
              >
                <Icon name={icon} size={17} />
                {label}
              </button>
            ))}
          </nav>
          {tab === "looks" ? (
            <div className="look-grid" role="tabpanel" aria-label="Looks">
              {[{ id: null, name: "None" }, ...looks].map((item) => (
                <button
                  key={item.id ?? "none"}
                  className={look === item.id ? "look-tile selected" : "look-tile"}
                  aria-pressed={look === item.id}
                  disabled={saving}
                  onClick={() => setLook(item.id)}
                >
                  <img src={preview(item.id, "thumb")} alt="" draggable={false} />
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="adjust-list" role="tabpanel" aria-label="Adjust">
              {ADJUSTMENTS.map(({ key, label }) => {
                // The fill runs from the middle, where zero is, to the thumb.
                const position = (values[key] + 100) / 2;
                return (
                  <label key={key} className="adjust-row">
                    <span>
                      {label}
                      <output>{signed(values[key])}</output>
                    </span>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      step={1}
                      value={values[key]}
                      disabled={saving}
                      style={
                        {
                          "--from": `${Math.min(50, position)}%`,
                          "--to": `${Math.max(50, position)}%`,
                        } as CSSProperties
                      }
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [key]: Number(event.target.value),
                        }))
                      }
                      onDoubleClick={() =>
                        setValues((current) => ({ ...current, [key]: 0 }))
                      }
                    />
                  </label>
                );
              })}
              <button
                className="glass-button"
                disabled={saving || !adjusted(values)}
                onClick={() => setValues(NO_ADJUSTMENTS)}
              >
                <Icon name="retry" size={17} />
                Reset adjustments
              </button>
            </div>
          )}
          {error && (
            <p className="editor-error" role="alert">
              {error}
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
