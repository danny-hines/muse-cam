export type Preset = {
  id: string;
  name: string;
  description: string;
  accent: string;
};
export type Notice = {
  id: number;
  kind: string;
  title: string;
  message: string;
  captureId: string | null;
};
export type CameraState = {
  focus: FocusState;
  previewSize: { width: number; height: number };
  status: string;
  preset: Preset;
  presets: Preset[];
  presetIndex: number;
  presetCount: number;
  message: string;
  networkOnline: boolean;
  queued: number;
  processingId: string | null;
  sharingId: string | null;
  battery: number | null;
  galleryRevision: number;
  galleryCount: number;
  notifications: Notice[];
  lastCaptureId: string | null;
  volume: number;
  processingSound: boolean;
  maintenance: boolean;
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
  | "back"
  | "share"
  | "remix"
  | "retry"
  | "restart_camera"
  | "power";
export type Photo = {
  id: string;
  presetId: string;
  presetName: string;
  status: string;
  error: string | null;
  shareUrl: string | null;
  createdAt: string;
  attempts: number;
  sourceUrl: string;
  resultUrl: string | null;
  thumbnailUrl: string;
};
export type GalleryData = {
  items: Photo[];
  counts: Record<string, number>;
  nextOffset: number | null;
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
