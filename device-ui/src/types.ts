import type { EditRecipe } from "./edit-math";

export type Preset = {
  id: string;
  // Original saves the photo as taken; Random picks an imagined style.
  kind: "original" | "random" | "imagined";
  name: string;
  description: string;
  accent: string;
};
export type Notice = {
  id: number;
  kind: string;
  title: string;
  message: string;
  // The version a notice is about, and its photo. A plain shot has no version.
  captureId: string | null;
  photoId: string | null;
};
export type CameraState = {
  view: {
    screen: "camera" | "gallery" | "photo" | "settings";
    photoId: string | null;
    versionId: string | null;
  };
  focus: FocusState;
  previewSize: { width: number; height: number };
  status: string;
  preset: Preset;
  presets: Preset[];
  presetIndex: number;
  presetCount: number;
  timerSeconds: 0 | 5 | 10;
  countdownRemaining: number;
  message: string;
  networkOnline: boolean;
  queued: number;
  pendingRetractions: number;
  processingId: string | null;
  sharingId: string | null;
  battery: number | null;
  galleryRevision: number;
  galleryCount: number;
  // Why a standalone camera can't style photos right now, such as a missing key.
  stylesOff: string | null;
  latestPhoto: { id: string; thumbnailUrl: string } | null;
  notifications: Notice[];
  lastCaptureId: string | null;
  volume: number;
  processingSound: boolean;
  maintenance: boolean;
  // False on standalone cameras, which have no server to share to.
  canShare: boolean;
  // Standalone cameras edit photos; Edited versions can't be shared.
  canEdit: boolean;
  looks: Look[];
  simulate: boolean;
  revision: number;
  sessionId: string;
};
export type FocusState = {
  supported: boolean;
  point: { x: number; y: number } | null;
  mode: "auto" | "spot";
  status: "idle" | "scanning" | "focused" | "failed" | "unavailable";
};
export type CameraAction =
  | "focus"
  | "focus_auto"
  | "previous"
  | "next"
  | "select"
  | "capture"
  | "timer"
  | "cancel_capture"
  | "back"
  | "view"
  | "share"
  | "remix"
  | "retry"
  | "restart_camera"
  | "power";
// One style applied to a photo's original.
export type Version = {
  id: string;
  photoId: string;
  presetId: string;
  presetName: string;
  status: string;
  error: string | null;
  shareUrl: string | null;
  createdAt: string;
  attempts: number;
  resultUrl: string | null;
  thumbnailUrl: string;
  // Set on an Edited version.
  edit: EditRecipe | null;
};
export type Look = { id: string; name: string };
// An original shot and the versions made from it.
export type Photo = {
  id: string;
  createdAt: string;
  // Waiting beats the cover's status; "original" means no versions yet.
  status: string;
  versionCount: number;
  // The version the roll shows: the newest finished one, else the newest.
  cover: Version | null;
  sourceUrl: string;
  thumbnailUrl: string;
};
export type GalleryData = {
  items: Photo[];
  counts: Record<string, number>;
  nextOffset: number | null;
};
export type PhotoDetailData = Photo & {
  versions: Version[];
  previousId: string | null;
  nextId: string | null;
};
export type Network = {
  ssid: string;
  signal: number;
  security: string;
  active: boolean;
};
export type DeviceJob = { phase: string; kind?: string; message?: string };
export type SettingsData = {
  volume: number;
  processingSound: boolean;
  audioAvailable: boolean;
  audioError: string | null;
  storage: { total: number; used: number; free: number };
  counts: Record<string, number>;
  battery: { percentage: number | null; supported: boolean; message: string };
  temperature: number | null;
  previewThrottled: boolean;
  device: {
    hostname?: string;
    addresses: string[];
    ssid: string;
    version?: string;
    error?: string;
    job: DeviceJob;
  };
};
export type UpdateInfo = {
  current: string;
  latest?: string;
  available: boolean;
  message: string;
  blocked?: boolean;
};
