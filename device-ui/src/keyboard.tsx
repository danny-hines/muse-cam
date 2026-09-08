import { useState } from "react";

export function TouchKeyboard({
  value,
  onChange,
  onDone,
}: {
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
}) {
  const [shift, setShift] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const rows = symbols
    ? shift
      ? ["[]{}<>|~\\%", "^*`€£¥_+=", "!?.,:;\"'"]
      : ["1234567890", "@#$&-+()/", "!?.,:;\"'="]
    : ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
  return (
    <div className="touch-keyboard" aria-label="On-screen keyboard">
      {rows.map((row, index) => (
        <div className="key-row" key={index}>
          {index === 2 && (
            <button
              className={shift ? "key active" : "key"}
              onClick={() => setShift(!shift)}
              aria-label="Shift"
            >
              ⇧
            </button>
          )}
          {Array.from(row).map((char) => (
            <button
              className="key"
              key={char}
              onClick={() =>
                onChange(
                  value + (shift && !symbols ? char.toUpperCase() : char),
                )
              }
            >
              {shift && !symbols ? char.toUpperCase() : char}
            </button>
          ))}
          {index === 2 && (
            <button
              className="key"
              aria-label="Backspace"
              onClick={() => onChange(value.slice(0, -1))}
            >
              ⌫
            </button>
          )}
        </div>
      ))}
      <div className="key-row">
        <button
          className="key wide"
          onClick={() => {
            setSymbols(!symbols);
            setShift(false);
          }}
        >
          {symbols ? "ABC" : "123 / #"}
        </button>
        <button
          className="key space"
          aria-label="Space"
          onClick={() => onChange(value + " ")}
        >
          space
        </button>
        <button className="key wide done" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
