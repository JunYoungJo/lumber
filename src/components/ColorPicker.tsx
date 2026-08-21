import { useMemo, useState } from "react";
import { useStrings } from "../i18n/useStrings";

export function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { h: 45, s: 75, l: 60 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
}

export function ColorPicker({
  color,
  onChange,
  onClose,
}: {
  color: string;
  onChange: (hex: string) => void;
  onClose: () => void;
}) {
  const init = useMemo(() => hexToHsl(color), []);
  const [hue, setHue] = useState(Math.round(init.h));
  const [light, setLight] = useState(Math.round(Math.min(85, Math.max(30, init.l))));
  const hex = hslToHex(hue, 80, light);
  const S = useStrings();

  function apply(h: number, l: number) {
    onChange(hslToHex(h, 80, l));
  }

  return (
    <div className="cpick">
      <div className="cp-row">
        <span className="cp-chip" style={{ background: hex }} />
        <code>{hex}</code>
        <span className="cp-done" onClick={onClose}>
          {S.common.done}
        </span>
      </div>
      <input
        type="range"
        className="cp-slider cp-hue"
        min={0}
        max={360}
        value={hue}
        onChange={(e) => {
          const h = Number(e.target.value);
          setHue(h);
          apply(h, light);
        }}
      />
      <input
        type="range"
        className="cp-slider cp-light"
        min={30}
        max={85}
        value={light}
        style={{ ["--cp" as string]: hslToHex(hue, 80, 55) }}
        onChange={(e) => {
          const l = Number(e.target.value);
          setLight(l);
          apply(hue, l);
        }}
      />
    </div>
  );
}
