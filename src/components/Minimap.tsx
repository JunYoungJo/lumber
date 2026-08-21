import { useEffect, useRef } from "react";
import { busOf } from "../controller";
import { useStore } from "../store";

const LEVEL_COLORS: Record<number, string> = {
  4: "#ffb340",
  5: "#ff6470",
  6: "#ff6470",
};

export function Minimap({ viewKey, tabId }: { viewKey: string; tabId: number }) {
  const tab = useStore((s) => s.tabs.find((t) => t.id === tabId) ?? null);
  const patchView = useStore((s) => s.patchView);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !tab?.overview) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const { minimapLevels, minimapMatch } = tab.overview;
    const n = minimapLevels.length;
    for (let i = 0; i < n; i++) {
      const y = (i / n) * h;
      const level = minimapLevels[i];
      const color = LEVEL_COLORS[level];
      if (color) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(3, y, w - 9, Math.max(1.5, h / n - 1));
      }
      if (minimapMatch[i]) {
        ctx.fillStyle = "#ffd166";
        ctx.globalAlpha = 1;
        ctx.fillRect(w - 5, y, 3, Math.max(1.5, h / n - 1));
      }
    }
    ctx.globalAlpha = 1;
  }, [tab?.overview]);

  if (!tab) return null;

  function click(e: React.MouseEvent) {
    const canvas = ref.current;
    if (!canvas || !tab) return;
    const rect = canvas.getBoundingClientRect();
    const frac = (e.clientY - rect.top) / rect.height;
    patchView(viewKey, { follow: false });
    busOf(viewKey)?.jump(Math.floor(frac * Math.max(0, tab.viewLen - 1)));
  }

  return <canvas ref={ref} className="minimap" onClick={click} />;
}
