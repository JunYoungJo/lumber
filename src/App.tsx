import { useEffect } from "react";
import { focusBus, focusedBus, jumpKind, openFileDialog } from "./controller";
import { wireEvents } from "./ipc/events";
import { useStore } from "./store";
import { Palette } from "./components/Palette";
import { Toasts, Workspace } from "./components/Shell";

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    location.reload();
  });
}

/// DOM 좌표 기반으로 dx/dy 방향의 가장 가까운 pane으로 포커스 이동
function focusNeighborPane(dx: number, dy: number) {
  const s = useStore.getState();
  const cur = s.focusedView;
  const els = [...document.querySelectorAll<HTMLElement>(".viewport[data-viewkey]")];
  if (!cur || els.length < 2) return;
  const curEl = els.find((el) => el.dataset.viewkey === cur);
  if (!curEl) return;
  const cr = curEl.getBoundingClientRect();
  const cx = cr.left + cr.width / 2;
  const cy = cr.top + cr.height / 2;
  let best: { key: string; score: number } | null = null;
  for (const el of els) {
    if (el === curEl) continue;
    const r = el.getBoundingClientRect();
    const vx = r.left + r.width / 2 - cx;
    const vy = r.top + r.height / 2 - cy;
    const main = dx !== 0 ? vx * dx : vy * dy;
    if (main <= 0) continue;
    const ortho = Math.abs(dx !== 0 ? vy : vx);
    const score = main + ortho * 2;
    if (!best || score < best.score) best = { key: el.dataset.viewkey!, score };
  }
  if (best) s.focusView(best.key);
}
import { Shortcuts } from "./components/Shortcuts";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";

export default function App() {
  useEffect(() => {
    const w = window as Window & { __lumberWired?: boolean };
    if (!w.__lumberWired) {
      w.__lumberWired = true;
      void wireEvents();
    }
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && ["k", "K", "f", "F"].includes(e.key)) {
        e.preventDefault();
        const sel = window.getSelection()?.toString().trim() ?? "";
        s.setPaletteOpen(true, sel.slice(0, 200));
        return;
      }
      if (mod && ["o", "O"].includes(e.key)) {
        e.preventDefault();
        void openFileDialog();
        return;
      }
      if (mod && ["w", "W"].includes(e.key)) {
        e.preventDefault();
        if (s.activeId !== null) s.closeTab(s.activeId);
        return;
      }
      if (e.key === "F3") {
        e.preventDefault();
        void jumpKind("match", e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === "F4") {
        e.preventDefault();
        void jumpKind("error", e.shiftKey ? -1 : 1);
        return;
      }
      if (mod && e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        void jumpKind("error", e.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (mod && !e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        void jumpKind("match", e.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (e.altKey && !mod && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (d) focusNeighborPane(d[0], d[1]);
        return;
      }
      if (e.altKey && e.key === "\\") {
        e.preventDefault();
        s.splitPane("row");
        return;
      }
      if (e.altKey && e.key === "-") {
        e.preventDefault();
        s.splitPane("col");
        return;
      }
      if (e.altKey && ["w", "W"].includes(e.key)) {
        e.preventDefault();
        s.closePane();
        return;
      }
      if (mod && e.key === "Tab") {
        e.preventDefault();
        s.cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.altKey && ["z", "Z"].includes(e.key)) {
        e.preventDefault();
        const t = s.active();
        if (t) s.patchTab(t.id, { wrap: !t.wrap });
        return;
      }
      if (mod && ["t", "T"].includes(e.key)) {
        e.preventDefault();
        s.setTheme(s.theme === "dark" ? "light" : "dark");
        return;
      }
      if (mod && ["l", "L"].includes(e.key)) {
        e.preventDefault();
        const key = s.focusedView;
        const vs = s.focusedViewState();
        if (key && vs) {
          const next = !vs.follow;
          s.patchView(key, { follow: next, pendingNew: 0 });
          if (next) focusedBus()?.toBottom();
        }
        return;
      }
      const typing = document.activeElement?.tagName === "INPUT";
      if (e.key === "/" && !mod && !typing) {
        e.preventDefault();
        focusBus.quickFilter();
        return;
      }
      if (e.key === "End" && !mod && !typing) {
        const key = s.focusedView;
        if (key) {
          e.preventDefault();
          s.patchView(key, { follow: true, pendingNew: 0 });
          focusedBus()?.toBottom();
        }
        return;
      }
      if (e.key === "?" && !typing) {
        e.preventDefault();
        s.setShortcutsOpen(true);
        return;
      }
      if (e.key === "Escape" && !typing) {
        const t = s.active();
        if (s.paletteOpen) s.setPaletteOpen(false);
        else if (s.shortcutsOpen) s.setShortcutsOpen(false);
        else if (t && t.detailOpen) s.patchTab(t.id, { detailOpen: false });
        else if (t && t.selectedLine !== null) s.patchTab(t.id, { selectedLine: null });
      }
    }
    function onContextMenu(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  return (
    <div className="app">
      <TitleBar />
      <Workspace />
      <StatusBar />
      <Palette />
      <Shortcuts />
      <Toasts />
    </div>
  );
}
