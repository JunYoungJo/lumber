import { open as openDialogRaw } from "@tauri-apps/plugin-dialog";
import { api } from "./ipc/api";
import { hasFilter, useStore } from "./store";

export interface ViewBus {
  jump: (row: number) => void;
  topRow: () => number;
  viewport: () => { top: number; bottom: number };
  toBottom: () => void;
}

const buses = new Map<string, ViewBus>();

export function registerBus(key: string, bus: ViewBus) {
  buses.set(key, bus);
}

export function unregisterBus(key: string) {
  buses.delete(key);
}

export function focusedBus(): ViewBus | null {
  const key = useStore.getState().focusedView;
  return key ? (buses.get(key) ?? null) : null;
}

export function busOf(key: string): ViewBus | null {
  return buses.get(key) ?? null;
}

export const focusBus = {
  quickFilter: () => {},
};

function unfollowFocused() {
  const s = useStore.getState();
  if (s.focusedView) s.patchView(s.focusedView, { follow: false });
}

export async function jumpKind(kind: "error" | "warn" | "match", dir: 1 | -1) {
  const s = useStore.getState();
  const t = s.active();
  const bus = focusedBus();
  if (!t || !bus) return;

  const vp = bus.viewport();
  const rowCount = hasFilter(t) ? t.viewLen : t.totalLines;

  if (kind === "match") {
    const { spec, total, cursor, cursorRow } = t.search;
    if (!spec || total === 0) {
      s.pushToast("검색 결과가 없습니다");
      return;
    }
    const cursorVisible = cursor !== null && cursorRow !== null && cursorRow >= vp.top && cursorRow <= vp.bottom;
    let res: [number, number] | null = null;
    let wrapped = false;
    if (cursorVisible) {
      let target = cursor + dir;
      if (target < 0) {
        target = total - 1;
        wrapped = true;
      } else if (target >= total) {
        target = 0;
        wrapped = true;
      }
      res = await api.matchNav(t.id, target, dir).catch(() => null);
    } else {
      // 스크롤로 다른 곳을 보고 있으면 지금 보이는 위치에서부터 찾는다
      res = await api.matchFromRow(t.id, dir > 0 ? vp.top : vp.bottom, dir).catch(() => null);
      if (!res) {
        res = await api.matchNav(t.id, dir > 0 ? 0 : total - 1, dir).catch(() => null);
        wrapped = res !== null;
      }
    }
    if (!res) {
      s.pushToast("현재 필터 뷰에 표시된 매치가 없습니다");
      return;
    }
    const [row, ordinal] = res;
    s.patchTab(t.id, { search: { ...t.search, cursor: ordinal, cursorRow: row } });
    unfollowFocused();
    bus.jump(row);
    if (wrapped) {
      s.pushToast(dir > 0 ? "처음 매치로 순환했습니다" : "마지막 매치로 순환했습니다");
    }
    return;
  }

  const cur = t.errorCursorRow;
  const curVisible = cur !== null && cur >= vp.top && cur <= vp.bottom;
  const from = curVisible ? cur : dir > 0 ? vp.top - 1 : vp.bottom + 1;
  let row = await api.jump(t.id, from, dir, kind).catch(() => null);
  let wrapped = false;
  if (row === null || row === undefined) {
    row = await api.jump(t.id, dir > 0 ? -1 : rowCount, dir, kind).catch(() => null);
    wrapped = row !== null && row !== undefined;
  }
  if (row !== null && row !== undefined) {
    s.patchTab(t.id, { errorCursorRow: row });
    unfollowFocused();
    bus.jump(row);
    if (wrapped) {
      s.pushToast(dir > 0 ? "처음 에러로 순환했습니다" : "마지막 에러로 순환했습니다");
    }
  } else {
    s.pushToast("표시된 뷰에 에러가 없습니다");
  }
}

export async function jumpToLine(line: number) {
  const s = useStore.getState();
  const t = s.active();
  const bus = focusedBus();
  if (!t || !bus) return;
  const rows = await api.linesToRows(t.id, [line]).catch(() => [null]);
  const row = rows[0];
  if (row !== null && row !== undefined) {
    unfollowFocused();
    bus.jump(row);
  } else {
    s.pushToast("해당 라인이 현재 뷰에 없습니다", "필터에 의해 숨겨졌을 수 있습니다");
  }
}

export async function openFileDialog() {
  const picked = await openDialogRaw({
    multiple: true,
    filters: [
      { name: "로그 파일", extensions: ["log", "txt", "jsonl", "ndjson", "out", "err"] },
      { name: "모든 파일", extensions: ["*"] },
    ],
  });
  if (!picked) return;
  const paths = Array.isArray(picked) ? picked : [picked];
  for (const p of paths) {
    await useStore.getState().openPath(p);
  }
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    location.reload();
  });
}
