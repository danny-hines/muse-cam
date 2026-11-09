import { useEffect, useRef, useState } from "react";
import type {
  CameraAction,
  CameraState,
  GalleryData,
  Photo,
  PhotoDetailData,
  Preset,
  Version,
} from "./types";
import { api } from "./use-camera";
import { Icon } from "./icons";
import { PhotoViewer } from "./photo-viewer";

type Act = (action: CameraAction, values?: object) => Promise<unknown>;
export const photoStatus = (status: string) =>
  ({
    complete: "Ready",
    failed: "Needs attention",
    uploading: "Imagining",
    queued: "Waiting",
    original: "Original",
  })[status] || status;
// Picker entries that are not a style a photo can be restyled with.
export const pickerOnly = (presetId: string) =>
  presetId === "random" || presetId === "original";
const isWaiting = (status: string) => status === "queued" || status === "uploading";

function StatusIcon({ status, shared }: { status: string; shared: boolean }) {
  const name =
    status === "complete"
      ? shared
        ? "share"
        : "spark"
      : status === "failed"
        ? "retry"
        : status === "original"
          ? "camera"
          : "clock";
  return <Icon name={name} size={13} />;
}

export function Gallery({
  state,
  filter,
  onFilter,
  onOpen,
  onCamera,
  report,
}: {
  state: CameraState;
  filter: string;
  onFilter: (filter: string) => void;
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
  // The camera filters by version status: a photo is waiting while any version is.
  const items = data.items;
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
          {state.pendingRetractions > 0 && (
            <p role="status">
              {state.pendingRetractions} public share {state.pendingRetractions === 1 ? "removal" : "removals"} waiting to sync
            </p>
          )}
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
            onClick={() => onFilter(key)}
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
            <PhotoCard key={photo.id} photo={photo} onOpen={() => onOpen(photo.id)} />
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

function PhotoCard({ photo, onOpen }: { photo: Photo; onOpen: () => void }) {
  const name = photo.cover?.presetName ?? "Original";
  const versions =
    photo.versionCount > 1 ? `, ${photo.versionCount} versions` : "";
  return (
    <button
      className="photo-card"
      onClick={onOpen}
      aria-label={`${name}, ${photoStatus(photo.status)}${versions}`}
    >
      <img src={photo.thumbnailUrl} alt="" loading="lazy" draggable={false} />
      <span className={`photo-status ${photo.status}`}>
        <StatusIcon status={photo.status} shared={!!photo.cover?.shareUrl} />
        {photoStatus(photo.status)}
      </span>
      {photo.versionCount > 1 && (
        <span className="photo-stack" aria-hidden="true">
          {photo.versionCount}
        </span>
      )}
      <span className="photo-caption">{name}</span>
    </button>
  );
}

export function PhotoDetail({
  id,
  versionId,
  state,
  filter,
  onOpen,
  act,
  onBack,
  onCamera,
  report,
}: {
  id: string;
  // The version the camera asked to show, such as one just restyled.
  versionId: string | null;
  state: CameraState;
  filter: string;
  onOpen: (id: string) => void;
  act: Act;
  onBack: () => void;
  onCamera: () => void;
  report: (message: string) => void;
}) {
  const [photo, setPhoto] = useState<PhotoDetailData | null>(null);
  // A version id, null for the original, or undefined to show the cover.
  const [selection, setSelection] = useState<string | null | undefined>(
    versionId ?? undefined,
  );
  const [original, setOriginal] = useState(false);
  const [remixing, setRemixing] = useState(false);
  const [presetId, setPresetId] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState<"version" | "photo" | null>(null);
  const [deleteError, setDeleteError] = useState("");
  useEffect(() => {
    if (versionId) setSelection(versionId);
  }, [versionId]);
  useEffect(() => {
    if (deleting === "photo") return;
    let active = true;
    api<PhotoDetailData>(`/api/gallery/${id}?filter=${encodeURIComponent(filter)}`)
      .then((next) => {
        if (active) setPhoto(next);
      })
      .catch((error) => {
        if (active) report(error.message);
      });
    return () => {
      active = false;
    };
  }, [id, state.galleryRevision, report, deleting, filter]);
  const versions = photo?.versions ?? [];
  const version: Version | null =
    selection === null
      ? null
      : (versions.find((item) => item.id === selection) ??
        versions.find((item) => item.id === photo?.cover?.id) ??
        null);
  const resultUrl = version?.resultUrl ?? null;
  useEffect(() => {
    setOriginal(false);
    const reset = () => setOriginal(false);
    window.addEventListener("blur", reset);
    return () => window.removeEventListener("blur", reset);
  }, [id, version?.id]);
  useEffect(() => {
    if (photo && resultUrl) {
      const image = new Image();
      image.src = photo.sourceUrl;
    }
  }, [photo?.sourceUrl, resultUrl]);
  const choose = (next: string | null) => {
    setSelection(next);
    setOriginal(false);
    void act("view", { screen: "photo", photoId: id, versionId: next }).catch(
      (error) => report(error.message),
    );
  };
  const perform = async (action: CameraAction, values: object) => {
    setPending(true);
    try {
      await act(action, values);
      setRemixing(false);
    } catch (error) {
      report((error as Error).message);
    } finally {
      setPending(false);
    }
  };
  const versionBusy = (item: Version) =>
    item.status === "uploading" ||
    state.processingId === item.id ||
    state.sharingId === item.id;
  const busy = !!version && versionBusy(version);
  const photoBusy = versions.some(versionBusy);
  // Restyle can pick Random, but Original is not a style.
  const styles = state.presets.filter((preset) => preset.id !== "original");
  const restyle = () => {
    // With a single style there is nothing to pick.
    if (styles.length === 1) {
      void perform("remix", { photoId: id, presetId: styles[0].id });
      return;
    }
    if (!styles.some((preset) => preset.id === presetId)) {
      const current = version?.presetId ?? state.preset.id;
      setPresetId(
        (styles.find((preset) => preset.id === current) ??
          styles.find((preset) => preset.id === state.preset.id) ??
          styles[0]).id,
      );
    }
    setRemixing(true);
  };
  const remove = async (scope: "version" | "photo") => {
    if (deleting || (scope === "version" ? busy : photoBusy)) return;
    setDeleteError("");
    setDeleting(scope);
    try {
      if (scope === "version" && version) {
        await api(`/api/versions/${encodeURIComponent(version.id)}/delete`, {});
        setSelection(undefined);
        setConfirmDelete(false);
        setDeleting(null);
      } else {
        await api(`/api/gallery/${encodeURIComponent(id)}/delete`, {});
        onBack();
      }
    } catch (error) {
      setDeleteError((error as Error).message);
      setDeleting(null);
    }
  };
  const showing = original || !version ? null : version.id;
  return (
    <section className="page detail-page" aria-label="Photo detail">
      {photo && (
        <PhotoViewer
          key={id}
          sourceUrl={photo.sourceUrl}
          resultUrl={resultUrl}
          original={original}
          disabled={remixing || confirmDelete}
          onCompare={setOriginal}
          onPrevious={photo.previousId ? () => onOpen(photo.previousId!) : undefined}
          onNext={photo.nextId ? () => onOpen(photo.nextId!) : undefined}
        />
      )}
      <header className="detail-header" inert={remixing}>
        <button className="glass-button" onClick={onBack}>
          <Icon name="back" />
          Your roll
        </button>
        {photo && versions.length > 0 ? (
          <nav className="version-strip" aria-label="Versions of this photo">
            <VersionChip
              label="Original"
              thumbnailUrl={`/api/gallery/${id}/thumbnail`}
              selected={showing === null}
              onSelect={() => choose(null)}
              original
            />
            {versions.map((item) => (
              <VersionChip
                key={item.id}
                label={`${item.presetName}, ${photoStatus(item.status)}`}
                thumbnailUrl={item.thumbnailUrl}
                status={item.status}
                selected={showing === item.id}
                onSelect={() => choose(item.id)}
              />
            ))}
          </nav>
        ) : (
          <span className="image-label">
            {original || !resultUrl ? "Original" : "Imagined"}
          </span>
        )}
        <button className="glass-button" onClick={onCamera}>
          <Icon name="camera" />
          Camera
        </button>
      </header>
      {photo && (
        <div className="detail-footer" inert={remixing}>
          <div className="detail-title">
            <span className="eyebrow">
              {version
                ? `${photoStatus(version.status)}${version.shareUrl ? " · Shared" : ""}`
                : versions.length
                  ? `${versions.length} ${versions.length === 1 ? "version" : "versions"}`
                  : "No style"}
            </span>
            <h1>{version?.presetName ?? "Original"}</h1>
            <p>
              {version?.status === "failed"
                ? version.error
                : resultUrl
                  ? "Swipe to browse · Pinch to zoom · Hold for original"
                  : version
                    ? "Swipe to browse · Pinch to zoom · Original saved"
                    : "Swipe to browse · Pinch to zoom"}
            </p>
          </div>
          <div className="detail-actions">
            {resultUrl && (
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
            {version?.status === "failed" && (
              <button
                className="glass-button"
                disabled={pending}
                onClick={() => void perform("retry", { captureId: version.id })}
              >
                <Icon name="retry" />
                Retry
              </button>
            )}
            {styles.length > 0 && (
              <button
                className="primary-button"
                disabled={pending}
                onClick={restyle}
              >
                <Icon name="spark" />
                Restyle
              </button>
            )}
            {resultUrl && version && state.canShare && (
              <button
                className="glass-button"
                disabled={pending || !!version.shareUrl || state.sharingId === version.id}
                onClick={() => void perform("share", { captureId: version.id })}
              >
                <Icon name={version.shareUrl ? "check" : "share"} />
                {version.shareUrl
                  ? "Shared"
                  : state.sharingId === version.id
                    ? "Sharing…"
                    : "Share"}
              </button>
            )}
            <button
              className="glass-button delete-photo-button"
              disabled={pending || (version ? busy : photoBusy)}
              onClick={() => {
                setDeleteError("");
                setConfirmDelete(true);
              }}
              title={
                (version ? busy : photoBusy)
                  ? "Available after processing or sharing finishes"
                  : "Delete"
              }
            >
              <Icon name="trash" />
              Delete
            </button>
          </div>
        </div>
      )}
      {!photo && <div className="empty-state">Loading photo…</div>}
      {confirmDelete && photo && (
        <DeleteDialog
          photo={photo}
          version={version}
          pending={deleting}
          versionBusy={busy}
          photoBusy={photoBusy}
          canShare={state.canShare}
          error={deleteError}
          onCancel={() => setConfirmDelete(false)}
          onDelete={(scope) => void remove(scope)}
        />
      )}
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
              {styles.map((preset) => (
                <StyleOption
                  key={preset.id}
                  preset={preset}
                  selected={presetId === preset.id}
                  onSelect={() => setPresetId(preset.id)}
                />
              ))}
            </div>
            <footer>
              <p>Adds a new version of this photo.</p>
              <button
                className="primary-button"
                disabled={pending}
                onClick={() => void perform("remix", { photoId: id, presetId })}
              >
                Create version
                <Icon name="spark" size={18} />
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}

function VersionChip({
  label,
  thumbnailUrl,
  status,
  selected,
  onSelect,
  original = false,
}: {
  label: string;
  thumbnailUrl: string;
  status?: string;
  selected: boolean;
  onSelect: () => void;
  original?: boolean;
}) {
  const chip = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selected) chip.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);
  return (
    <button
      ref={chip}
      className={`version-chip${selected ? " selected" : ""}${original ? " original" : ""}`}
      aria-label={label}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <img src={thumbnailUrl} alt="" draggable={false} />
      {original && <Icon name="camera" size={16} />}
      {status && status !== "complete" && (
        <span className={`version-dot ${isWaiting(status) ? "waiting" : status}`} />
      )}
    </button>
  );
}

function DeleteDialog({
  photo,
  version,
  pending,
  versionBusy,
  photoBusy,
  canShare,
  error,
  onCancel,
  onDelete,
}: {
  photo: PhotoDetailData;
  version: Version | null;
  pending: "version" | "photo" | null;
  versionBusy: boolean;
  photoBusy: boolean;
  canShare: boolean;
  error: string;
  onCancel: () => void;
  onDelete: (scope: "version" | "photo") => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const count = photo.versions.length;
  const others = count - (version ? 1 : 0);
  const busy = version ? versionBusy : photoBusy;
  return (
    <dialog
      ref={dialog}
      className="delete-dialog"
      aria-labelledby="delete-photo-title"
      aria-describedby="delete-photo-description"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <div className="delete-preview">
        <img
          src={version ? version.thumbnailUrl : `/api/gallery/${photo.id}/thumbnail`}
          alt=""
          draggable={false}
        />
        <div>
          <span className="eyebrow">{version?.presetName ?? "Original"}</span>
          <h2 id="delete-photo-title">
            {version ? "Delete this version?" : "Delete this photo?"}
          </h2>
        </div>
      </div>
      <div id="delete-photo-description">
        <p>
          {version
            ? `The ${version.presetName} version will be removed from the camera. The original${others ? ` and ${others} other ${others === 1 ? "version" : "versions"}` : ""} will be kept.`
            : count
              ? `The original and its ${count} ${count === 1 ? "version" : "versions"} will be removed from the camera.`
              : "The saved original will be removed from the camera."}
          {version?.status === "queued" ? " Queued processing will be canceled." : ""}
        </p>
        <p>This can’t be undone.</p>
        {canShare && (
          <p>
            Any public share will also be removed. If offline, the link stays online until
            this camera reconnects and syncs the deletion.
          </p>
        )}
      </div>
      {busy && <p role="status">Wait for processing or sharing to finish.</p>}
      {error && <p role="alert">{error}</p>}
      <footer>
        <button
          className="glass-button"
          autoFocus
          disabled={!!pending}
          onClick={onCancel}
        >
          Keep
        </button>
        {version && (
          <button
            className="glass-button delete-photo-button"
            disabled={!!pending || photoBusy}
            onClick={() => onDelete("photo")}
          >
            {pending === "photo" ? "Deleting…" : "Delete whole photo"}
          </button>
        )}
        <button
          className="danger-button"
          disabled={!!pending || busy}
          onClick={() => onDelete(version ? "version" : "photo")}
        >
          <Icon name="trash" size={19} />
          {pending && pending === (version ? "version" : "photo")
            ? "Deleting…"
            : version
              ? "Delete version"
              : "Delete photo"}
        </button>
      </footer>
    </dialog>
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
