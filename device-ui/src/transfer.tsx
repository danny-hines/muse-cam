import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { api } from "./use-camera";
import { Icon } from "./icons";

type TransferStatus =
  | { active: false }
  | { active: true; url: string; ssid: string; visits: number };

// The camera closes the photos when this screen stops asking about them.
const ASK_EVERY = 5000;

function QrCode({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(text);
    code.make();
    const count = code.getModuleCount();
    let drawn = "";
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (code.isDark(row, column)) drawn += `M${column} ${row}h1v1h-1z`;
      }
    }
    return { size: count, path: drawn };
  }, [text]);
  // Phones need the light margin around the code to find it.
  return (
    <svg
      className="transfer-code"
      viewBox={`-4 -4 ${size + 8} ${size + 8}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code that opens this camera's photos"
    >
      <rect x={-4} y={-4} width={size + 8} height={size + 8} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

// Opens the camera's photos to phones and computers on the same Wi-Fi for as
// long as this screen is showing.
export function Transfer({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<TransferStatus>({ active: false });
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let showing = true;
    const open = () =>
      api<TransferStatus>("/api/transfer/start", {}).then(
        (next) => {
          if (!showing) return;
          setStatus(next);
          setError("");
        },
        (problem: Error) => {
          if (!showing) return;
          setStatus({ active: false });
          setError(problem.message);
        },
      );
    void open();
    const timer = window.setInterval(() => {
      api<TransferStatus>("/api/transfer").then(
        (next) => {
          if (!showing) return;
          // Closed because the screen went quiet for a while: open again.
          if (next.active) setStatus(next);
          else void open();
        },
        () => undefined,
      );
    }, ASK_EVERY);
    return () => {
      showing = false;
      window.clearInterval(timer);
      void api("/api/transfer/stop", {}).catch(() => undefined);
    };
  }, [attempt]);
  return (
    <section className="editor transfer" role="dialog" aria-modal="true" aria-label="Get photos">
      <header className="editor-header">
        <div className="editor-title">
          <span className="eyebrow">Phone or computer</span>
          <h1>Get photos</h1>
        </div>
        <button className="primary-button" onClick={onClose}>
          <Icon name="check" size={19} />
          Done
        </button>
      </header>
      {status.active ? (
        <div className="transfer-body">
          <QrCode text={status.url} />
          <ol className="transfer-steps">
            <li>
              <strong>
                Join {status.ssid ? `“${status.ssid}”` : "the camera’s Wi-Fi"} on your phone
              </strong>
              <span>The camera and the phone have to be on the same Wi-Fi. A phone’s hotspot works too.</span>
            </li>
            <li>
              <strong>Scan the code with the phone’s camera</strong>
              <span>
                On a computer, type <b>{status.url.replace(/^http:\/\//, "").replace(/\/$/, "")}</b>
              </span>
            </li>
            <li>
              <strong>Save the photos you want</strong>
              <span>
                {status.visits > 0
                  ? "Connected. The photos stay open until you tap Done."
                  : "Anyone on this Wi-Fi with the code can see them until you tap Done."}
              </span>
            </li>
          </ol>
        </div>
      ) : (
        <div className="transfer-wait" role={error ? "alert" : "status"}>
          <Icon name={error ? "wifi" : "share"} size={30} />
          <p>{error || "Opening your photos…"}</p>
          {error && (
            <button className="glass-button" onClick={() => setAttempt((count) => count + 1)}>
              <Icon name="retry" size={17} />
              Try again
            </button>
          )}
        </div>
      )}
    </section>
  );
}
