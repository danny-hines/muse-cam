import { useEffect, useState } from "react";
import type {
  CameraAction,
  CameraState,
  GalleryData,
  Photo,
  Preset,
} from "./types";
import { api } from "./use-camera";
import { Icon } from "./icons";

type Act = (action: CameraAction, values?: object) => Promise<unknown>;
export const photoStatus = (status: string) =>
  ({
    complete: "Ready",
    failed: "Needs attention",
    uploading: "Imagining",
    queued: "Waiting",
  })[status] || status;

export function Gallery({
  state,
  onOpen,
  onCamera,
  report,
}: {
  state: CameraState;
  onOpen: (id: string) => void;
  onCamera: () => void;
  report: (message: string) => void;
}) {
  const [data, setData] = useState<GalleryData>({
    items: [],
    counts: {},
    nextOffset: null,
  });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<GalleryData>(`/api/gallery?filter=${filter}`)
      .then((next) => {
        if (active) setData(next);
      })
      .catch((error) => {
        if (active) report(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [state.galleryRevision, report, filter]);
  const loadMore = async () => {
    setLoading(true);
    try {
      const next = await api<GalleryData>(
        `/api/gallery?offset=${data.nextOffset}&filter=${filter}`,
      );
      setData((current) => ({
        ...next,
        items: [
          ...current.items,
          ...next.items.filter(
            (p) => !current.items.some((n) => n.id === p.id),
          ),
        ],
      }));
    } catch (error) {
      report((error as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const items = data.items.filter(
    (photo) =>
      filter === "all" ||
      (filter === "waiting"
        ? ["queued", "uploading"].includes(photo.status)
        : photo.status === filter),
  );
  return (
    <section className="page gallery-page" aria-label="Local gallery">
      <header className="page-header">
        <button
          className="icon-button"
          aria-label="Back to camera"
          onClick={onCamera}
        >
          <Icon name="back" />
        </button>
        <div>
          <h1>Your roll</h1>
          <p>{state.galleryCount} photos · saved on this camera</p>
        </div>
        <Icon name="gallery" />
      </header>
      <nav className="filter-row" aria-label="Filter photos">
        {[
          ["all", "All"],
          ["complete", "Ready"],
          ["waiting", "Waiting"],
          ["failed", "Needs attention"],
        ].map(([key, label]) => (
          <button
            key={key}
            disabled={loading}
            className={filter === key ? "chip selected" : "chip"}
            onClick={() => setFilter(key)}
          >
            {label}
            {key === "failed" && (data.counts.failed || 0) > 0
              ? ` · ${data.counts.failed}`
              : ""}
          </button>
        ))}
      </nav>
      <div className="gallery-scroll">
        <div className="photo-grid">
          {items.map((photo) => (
            <button
              key={photo.id}
              className="photo-card"
              onClick={() => onOpen(photo.id)}
              aria-label={`${photo.presetName}, ${photoStatus(photo.status)}`}
            >
              <img
                src={photo.thumbnailUrl}
                alt=""
                loading="lazy"
                draggable={false}
              />
              <span className={`photo-status ${photo.status}`}>
                {photo.status === "complete" ? (
                  <Icon name={photo.shareUrl ? "share" : "spark"} size={13} />
                ) : (
                  <Icon
                    name={photo.status === "failed" ? "retry" : "clock"}
                    size={13}
                  />
                )}
                {photoStatus(photo.status)}
              </span>
              <span className="photo-caption">{photo.presetName}</span>
            </button>
          ))}
        </div>
        {!loading && items.length === 0 && (
          <div className="empty-state">
            <Icon name="gallery" size={36} />
            <h2>
              {filter === "all"
                ? "Your next idea starts here"
                : "Nothing here yet"}
            </h2>
            <p>
              {filter === "all"
                ? "Press the camera’s shutter. Originals and imagined photos will live here."
                : "Photos in this state will appear here."}
            </p>
            <button className="primary-button" onClick={onCamera}>
              Back to camera
            </button>
          </div>
        )}
        {loading && <p className="load-status">Loading photos…</p>}
        {data.nextOffset !== null && (
          <button
            className="load-more"
            onClick={() => void loadMore()}
            disabled={loading}
          >
            Load older photos
          </button>
        )}
      </div>
    </section>
  );
}

export function PhotoDetail({
  id,
  state,
  act,
  onBack,
  onCamera,
  report,
}: {
  id: string;
  state: CameraState;
  act: Act;
  onBack: () => void;
  onCamera: () => void;
  report: (message: string) => void;
}) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [original, setOriginal] = useState(false);
  const [remixing, setRemixing] = useState(false);
  const [presetId, setPresetId] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let active = true;
    api<Photo>(`/api/gallery/${id}`)
      .then((next) => {
        if (active) {
          setPhoto(next);
          setPresetId((current) => current || next.presetId);
        }
      })
      .catch((error) => {
        if (active) report(error.message);
      });
    return () => {
      active = false;
    };
  }, [id, state.galleryRevision, report]);
  useEffect(() => {
    setOriginal(false);
    const reset = () => setOriginal(false);
    window.addEventListener("blur", reset);
    return () => window.removeEventListener("blur", reset);
  }, [id]);
  useEffect(() => {
    if (photo?.resultUrl) {
      const image = new Image();
      image.src = photo.sourceUrl;
    }
  }, [photo?.sourceUrl, photo?.resultUrl]);
  const perform = async (action: CameraAction, values: object = {}) => {
    setPending(true);
    try {
      await act(action, { captureId: id, ...values });
      setRemixing(false);
    } catch (error) {
      report((error as Error).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="page detail-page" aria-label="Photo detail">
      {photo && (
        <img
          className="detail-image"
          inert={remixing}
          src={original || !photo.resultUrl ? photo.sourceUrl : photo.resultUrl}
          alt={original ? "Original photograph" : "Imagined photograph"}
          draggable={false}
          onPointerDown={(event) => {
            if (photo.resultUrl) {
              event.currentTarget.setPointerCapture(event.pointerId);
              setOriginal(true);
            }
          }}
          onPointerUp={() => setOriginal(false)}
          onPointerCancel={() => setOriginal(false)}
          onLostPointerCapture={() => setOriginal(false)}
          onContextMenu={(event) => event.preventDefault()}
        />
      )}
      <header className="detail-header" inert={remixing}>
        <button className="glass-button" onClick={onBack}>
          <Icon name="back" />
          Your roll
        </button>
        <span className="image-label">
          {original || !photo?.resultUrl ? "Original" : "Imagined"}
        </span>
        <button className="glass-button" onClick={onCamera}>
          <Icon name="camera" />
          Camera
        </button>
      </header>
      {photo && (
        <div className="detail-footer" inert={remixing}>
          <div className="detail-title">
            <span className="eyebrow">
              {photoStatus(photo.status)}
              {photo.shareUrl ? " · Shared" : ""}
            </span>
            <h1>{photo.presetName}</h1>
            <p>
              {photo.status === "failed"
                ? photo.error
                : photo.resultUrl
                  ? "Hold the photo to see the original"
                  : "You can keep shooting while this photo waits"}
            </p>
          </div>
          <div className="detail-actions">
            {photo.resultUrl && (
              <button
                className="glass-button"
                aria-label="Hold to view original"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setOriginal(true);
                }}
                onPointerUp={() => setOriginal(false)}
                onPointerCancel={() => setOriginal(false)}
                onLostPointerCapture={() => setOriginal(false)}
                onKeyDown={(event) => {
                  if (event.key === " ") setOriginal(true);
                }}
                onKeyUp={() => setOriginal(false)}
              >
                <Icon name="eye" />
                Hold
              </button>
            )}
            {photo.status === "failed" && (
              <button
                className="glass-button"
                disabled={pending}
                onClick={() => void perform("retry")}
              >
                <Icon name="retry" />
                Retry
              </button>
            )}
            <button
              className="primary-button"
              disabled={pending}
              onClick={() => setRemixing(true)}
            >
              <Icon name="spark" />
              Restyle
            </button>
            {photo.resultUrl && (
              <button
                className="glass-button"
                disabled={pending || !!photo.shareUrl || state.sharingId === id}
                onClick={() => void perform("share")}
              >
                <Icon name={photo.shareUrl ? "check" : "share"} />
                {photo.shareUrl
                  ? "Shared"
                  : state.sharingId === id
                    ? "Sharing…"
                    : "Share"}
              </button>
            )}
          </div>
        </div>
      )}
      {!photo && <div className="empty-state">Loading photo…</div>}
      {remixing && (
        <div className="modal-scrim">
          <section
            className="style-sheet"
            role="dialog"
            aria-label="Restyle photo"
            aria-modal="true"
          >
            <header>
              <div>
                <span className="eyebrow">Same moment, new imagination</span>
                <h2>Try another style</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close style picker"
                onClick={() => setRemixing(false)}
              >
                <Icon name="close" />
              </button>
            </header>
            <div className="style-options">
              {state.presets.map((preset) => (
                <StyleOption
                  key={preset.id}
                  preset={preset}
                  selected={presetId === preset.id}
                  onSelect={() => setPresetId(preset.id)}
                />
              ))}
            </div>
            <footer>
              <p>Adds a new photo to your roll.</p>
              <button
                className="primary-button"
                disabled={pending}
                onClick={() => void perform("remix", { presetId })}
              >
                Create new photo
                <Icon name="spark" size={18} />
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}

export function StyleOption({
  preset,
  selected,
  onSelect,
}: {
  preset: Preset;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={selected ? "style-option selected" : "style-option"}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="style-swatch" style={{ background: preset.accent }}>
        <Icon name="spark" size={19} />
      </span>
      <span>
        <strong>{preset.name}</strong>
        <small>{preset.description}</small>
      </span>
      {selected && <Icon name="check" size={18} />}
    </button>
  );
}
