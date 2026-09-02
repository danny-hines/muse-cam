export type CameraStatus =
  | "starting"
  | "live"
  | "capturing"
  | "processing"
  | "result"
  | "sharing"
  | "error"
  | "shutting_down";

export type Preset = {
  id: string;
  name: string;
  description: string;
  accent: string;
};

export type CameraState = {
  status: CameraStatus;
  preset: Preset;
  presetIndex: number;
  presetCount: number;
  message: string;
  networkOnline: boolean;
  queued: number;
  battery: number | null;
  shared: boolean;
  shareUrl: string | null;
  resultUrl: string | null;
  revision: number;
};

export type CameraAction = "previous" | "next" | "capture" | "back" | "share" | "power";
