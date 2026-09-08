import { useEffect, useRef, useState } from "react";
import type { CameraState, Network, SettingsData, UpdateInfo } from "./types";
import { api } from "./use-camera";
import { Icon } from "./icons";
import { TouchKeyboard } from "./keyboard";

const formatBytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
export function Settings({
  state,
  onCamera,
  report,
}: {
  state: CameraState;
  onCamera: () => void;
  report: (message: string) => void;
}) {
  const [tab, setTab] = useState("sound");
  const [data, setData] = useState<SettingsData | null>(null);
  const [networks, setNetworks] = useState<Network[]>([]);
  const [scanning, setScanning] = useState(false);
  const [network, setNetwork] = useState<Network | null>(null);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keyboardField, setKeyboardField] = useState<
    "ssid" | "password" | null
  >(null);
  const [connecting, setConnecting] = useState(false);
  const [volume, setVolume] = useState(state.volume);
  const [processing, setProcessing] = useState(state.processingSound);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const volumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousVolume = useRef(35);
  const saveSequence = useRef(Promise.resolve());
  const job = data?.device.job;
  const jobBusy = job?.phase === "running";
  const workBusy =
    !!state.processingId || !!state.sharingId || state.queued > 0;

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await api<SettingsData>("/api/settings");
        if (active) setData(next);
      } catch (error) {
        if (active && !state.maintenance) report((error as Error).message);
      }
      if (active) timer = setTimeout(() => void refresh(), 3500);
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [report, state.maintenance]);
  // Persist even if this screen closes before a debounced slider write fires.
  const saveSound = (nextVolume: number, nextProcessing: boolean) => {
    setVolume(nextVolume);
    setProcessing(nextProcessing);
    if (volumeTimer.current) clearTimeout(volumeTimer.current);
    volumeTimer.current = setTimeout(() => {
      saveSequence.current = saveSequence.current
        .then(async () => {
          await api("/api/settings", {
            volume: nextVolume,
            processingSound: nextProcessing,
          });
        })
        .catch((error) => report(error.message));
    }, 180);
  };
  const scan = async () => {
    setScanning(true);
    try {
      setNetworks(
        (await api<{ networks: Network[] }>("/api/system/wifi-scan", {}))
          .networks,
      );
    } catch (error) {
      report((error as Error).message);
    } finally {
      setScanning(false);
    }
  };
  const chooseNetwork = (next: Network) => {
    setNetwork(next);
    setSsid(next.ssid);
    setPassword("");
    setShowPassword(false);
    setKeyboardField(next.ssid ? "password" : "ssid");
  };
  const join = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      await api("/api/system/wifi-connect", {
        ssid,
        password,
        hidden: network?.ssid === "",
      });
      setPassword("");
      setNetwork(null);
      setKeyboardField(null);
      setData(await api<SettingsData>("/api/settings"));
    } catch (error) {
      report((error as Error).message);
    } finally {
      setConnecting(false);
    }
  };
  const checkUpdate = async () => {
    setChecking(true);
    try {
      setUpdate(await api<UpdateInfo>("/api/system/update-check", {}));
    } catch (error) {
      report((error as Error).message);
    } finally {
      setChecking(false);
    }
  };
  const install = async () => {
    setInstalling(true);
    try {
      await api("/api/system/update-apply", {});
      setData(await api<SettingsData>("/api/settings"));
    } catch (error) {
      report((error as Error).message);
    } finally {
      setInstalling(false);
    }
  };
  const testSound = async (cue: string) => {
    try {
      if (volumeTimer.current) {
        clearTimeout(volumeTimer.current);
        volumeTimer.current = null;
      }
      await saveSequence.current;
      await api("/api/settings", { volume, processingSound: processing });
      await api("/api/sound", { cue });
      if (state.simulate) report("Sound preview plays on the physical camera.");
    } catch (error) {
      report((error as Error).message);
    }
  };
  return (
    <section className="page settings-page" aria-label="Camera settings">
      <header className="page-header" inert={!!network}>
        <button
          className="icon-button"
          aria-label="Back to camera"
          onClick={onCamera}
        >
          <Icon name="back" />
        </button>
        <div>
          <h1>Make it yours</h1>
          <p>Camera settings</p>
        </div>
        <span className="version-tag">MuseCam 0.3</span>
      </header>
      <div className="settings-body" inert={!!network}>
        <nav className="settings-tabs" aria-label="Settings sections">
          {(
            [
              ["sound", "volume", "Sounds"],
              ["wifi", "wifi", "Wi-Fi"],
              ["storage", "storage", "Storage"],
              ["device", "settings", "Device"],
            ] as const
          ).map(([key, icon, label]) => (
            <button
              key={key}
              className={tab === key ? "selected" : ""}
              onClick={() => {
                setTab(key);
                if (key === "wifi" && !networks.length) void scan();
              }}
            >
              <Icon name={icon} />
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === "sound" && (
            <>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">A little personality</span>
                  <h2>Sound & volume</h2>
                </div>
                <button
                  className={volume === 0 ? "chip selected" : "chip"}
                  onClick={() => {
                    if (volume) previousVolume.current = volume;
                    saveSound(volume ? 0 : previousVolume.current, processing);
                  }}
                >
                  <Icon name={volume ? "volume" : "mute"} />
                  {volume ? "Mute" : "Muted"}
                </button>
              </div>
              <div className="setting-card volume-card">
                <label htmlFor="volume">
                  Master volume<strong>{volume}%</strong>
                </label>
                <input
                  id="volume"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={volume}
                  onChange={(event) =>
                    saveSound(Number(event.target.value), processing)
                  }
                />
                <p>
                  Every sound follows this setting. Zero is completely silent.
                </p>
              </div>
              <label className="setting-card toggle-row">
                <div>
                  <strong>Quiet processing chirps</strong>
                  <p>A brief, low burble every seven seconds.</p>
                </div>
                <input
                  type="checkbox"
                  checked={processing}
                  onChange={(event) => saveSound(volume, event.target.checked)}
                />
                <span className="switch" aria-hidden="true" />
              </label>
              <div className="sound-tests">
                {[
                  ["shutter", "Click"],
                  ["processing", "Processing"],
                  ["success", "Ready"],
                  ["error", "Error"],
                ].map(([key, label]) => (
                  <button
                    className="secondary-button"
                    key={key}
                    disabled={
                      volume === 0 || (key === "processing" && !processing)
                    }
                    onClick={() => void testSound(key)}
                  >
                    {label}
                    <span>Test sound</span>
                  </button>
                ))}
              </div>
              {data && !data.audioAvailable && !state.simulate && (
                <p className="inline-error">
                  Speaker unavailable. Audio setup may need checking.
                </p>
              )}
              {data?.audioError && (
                <p className="inline-error">{data.audioError}</p>
              )}
            </>
          )}
          {tab === "wifi" && (
            <>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Take it anywhere</span>
                  <h2>Wi-Fi networks</h2>
                </div>
                <button
                  className="chip"
                  disabled={scanning || jobBusy}
                  onClick={() => void scan()}
                >
                  <Icon name="retry" size={18} />
                  {scanning ? "Scanning…" : "Refresh"}
                </button>
              </div>
              <div className="network-current">
                <span className="status-dot" />
                <div>
                  <strong>{data?.device.ssid || "Checking connection…"}</strong>
                  <small>
                    {data?.device.addresses.join(" · ") ||
                      "No address assigned"}
                  </small>
                </div>
              </div>
              {job?.kind === "wifi" && job.phase !== "idle" && (
                <p className={`job-message ${job.phase}`} role="status">
                  {job.message}
                </p>
              )}
              {data?.device.error && (
                <p className="inline-error">{data.device.error}</p>
              )}
              <div className="network-list">
                {networks.map((item) => (
                  <button
                    key={item.ssid}
                    disabled={jobBusy || item.security.includes("802.1X")}
                    onClick={() => chooseNetwork(item)}
                  >
                    <Icon name="wifi" />
                    <span>
                      <strong>{item.ssid}</strong>
                      <small>
                        {item.security.includes("802.1X")
                          ? "Enterprise · use a saved profile or guest network"
                          : item.ssid === data?.device.ssid
                            ? "Connected"
                            : item.security || "Open network"}
                      </small>
                    </span>
                    <span>{item.signal}%</span>
                    {item.ssid === data?.device.ssid ? (
                      <Icon name="check" size={18} />
                    ) : (
                      <Icon name="next" size={18} />
                    )}
                  </button>
                ))}
              </div>
              {!scanning && networks.length === 0 && (
                <p className="muted-copy">
                  No networks found. Refresh or enter a network name.
                </p>
              )}
              <button
                className="text-button"
                disabled={jobBusy}
                onClick={() =>
                  chooseNetwork({
                    ssid: "",
                    signal: 0,
                    security: "WPA2",
                    active: false,
                  })
                }
              >
                Join a hidden or other network
              </button>
              <p className="muted-copy">
                Saved Wi-Fi reconnects automatically. For office networks that
                need a browser login or certificates, use guest Wi-Fi or a
                hotspot.
              </p>
            </>
          )}
          {tab === "storage" && (
            <>
              <span className="eyebrow">Every version of the moment</span>
              <h2>Space for your ideas</h2>
              {data ? (
                <>
                  <div className="setting-card storage-card">
                    <strong>
                      {formatBytes(data.storage.free)}
                      <small>available</small>
                    </strong>
                    <div className="storage-track">
                      <span
                        style={{
                          width: `${(data.storage.used / data.storage.total) * 100}%`,
                        }}
                      />
                    </div>
                    <p>
                      {formatBytes(data.storage.used)} used of{" "}
                      {formatBytes(data.storage.total)}
                    </p>
                  </div>
                  <div className="storage-stats">
                    <div>
                      <strong>{state.galleryCount}</strong>
                      <span>Saved photos</span>
                    </div>
                    <div>
                      <strong>
                        {(data.counts.queued || 0) +
                          (data.counts.uploading || 0)}
                      </strong>
                      <span>Waiting / imagining</span>
                    </div>
                    <div>
                      <strong>{data.counts.failed || 0}</strong>
                      <span>Need attention</span>
                    </div>
                  </div>
                  <p className="muted-copy">
                    Originals and imagined photos stay on this camera. Restyling
                    adds a new photo. Nothing in your roll is automatically
                    deleted.
                  </p>
                </>
              ) : (
                <p>Checking storage…</p>
              )}
            </>
          )}
          {tab === "device" && (
            <>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Ready for what’s next</span>
                  <h2>This camera</h2>
                </div>
                <Icon name="camera" size={30} />
              </div>
              <div className="setting-card device-facts">
                <div>
                  <span>Name</span>
                  <strong>{data?.device.hostname || "MuseCam"}</strong>
                </div>
                <div>
                  <span>Software</span>
                  <strong>{data?.device.version || "Checking…"}</strong>
                </div>
                <div>
                  <span>Address</span>
                  <strong>
                    {data?.device.addresses.join(", ") || "Unavailable"}
                  </strong>
                </div>
              </div>
              <div className="setting-card battery-card">
                <Icon name="battery" size={28} />
                <div>
                  <strong>
                    {data?.battery.percentage != null
                      ? `${data.battery.percentage}% battery`
                      : "Battery level unavailable"}
                  </strong>
                  <p>
                    {data?.battery.percentage != null
                      ? "Reported by the power board"
                      : data?.battery.message || "Checking power board…"}
                  </p>
                </div>
              </div>
              <div className="update-row">
                <div>
                  <strong>Software updates</strong>
                  <p>
                    {job?.kind === "update" && job.phase !== "idle"
                      ? job.message
                      : update?.message ||
                        "Check for the latest camera improvements."}
                  </p>
                </div>
                <button
                  className="secondary-button"
                  disabled={checking || jobBusy || installing}
                  onClick={() => void checkUpdate()}
                >
                  {checking ? "Checking…" : "Check for updates"}
                </button>
              </div>
              {update?.available && (
                <>
                  <button
                    className="primary-button"
                    disabled={workBusy || jobBusy || installing}
                    onClick={() => void install()}
                  >
                    <Icon name="update" />
                    {installing || jobBusy
                      ? "Installing…"
                      : "Install update & restart"}
                  </button>
                  <p className="muted-copy">
                    {workBusy
                      ? "Let queued photos finish first."
                      : "Keep the camera powered on. Your photos and settings are preserved."}
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
      {network && (
        <div
          className="network-editor"
          role="dialog"
          aria-modal="true"
          aria-label="Join Wi-Fi network"
        >
          <header className="page-header">
            <button
              className="icon-button"
              aria-label="Cancel Wi-Fi connection"
              disabled={connecting}
              onClick={() => {
                setNetwork(null);
                setPassword("");
                setKeyboardField(null);
              }}
            >
              <Icon name="close" />
            </button>
            <div>
              <h1>{network.ssid || "Join a network"}</h1>
              <p>Password stays on this camera</p>
            </div>
            <button
              className="primary-button"
              disabled={!ssid.trim() || connecting}
              onClick={() => void join()}
            >
              {connecting ? "Connecting…" : "Connect"}
            </button>
          </header>
          <div className="network-fields">
            {!network.ssid && (
              <label>
                Network name
                <input
                  aria-label="Network name"
                  inputMode="none"
                  value={ssid}
                  onFocus={() => setKeyboardField("ssid")}
                  onChange={(event) => setSsid(event.target.value)}
                />
              </label>
            )}
            <label>
              Password{" "}
              <span className="optional">
                optional for saved / open networks
              </span>
              <div className="password-field">
                <input
                  aria-label="Wi-Fi password"
                  autoComplete="off"
                  inputMode="none"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onFocus={() => setKeyboardField("password")}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  <Icon name="eye" />
                </button>
              </div>
            </label>
          </div>
          {keyboardField && (
            <TouchKeyboard
              value={keyboardField === "ssid" ? ssid : password}
              onChange={keyboardField === "ssid" ? setSsid : setPassword}
              onDone={() => setKeyboardField(null)}
            />
          )}
          {!keyboardField && (
            <button
              className="secondary-button keyboard-reopen"
              onClick={() => setKeyboardField("password")}
            >
              Show keyboard
            </button>
          )}
        </div>
      )}
    </section>
  );
}
