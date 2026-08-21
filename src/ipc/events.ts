import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { strings } from "../i18n";
import { lineCache } from "../lineCache";
import { hasFilter, useStore } from "../store";
import { LineOut } from "./api";

interface IndexProgress {
  id: number;
  lines: number;
  bytes: number;
  size: number;
  done: boolean;
  json?: boolean;
}

interface TailAppended {
  id: number;
  lines: number;
  rolledBackTo: number;
  /// 무필터 뷰일 때 새 라인 데이터가 함께 실려 온다(마지막 300줄 캡)
  tail: { start: number; gen: number; lines: LineOut[] } | null;
}

interface ViewUpdate {
  id: number;
  gen: number;
  viewLen: number;
  total: number;
  done: boolean;
}

interface SearchUpdate {
  id: number;
  gen: number;
  total: number;
  scanned?: number;
  of?: number;
  done: boolean;
  cleared?: boolean;
}

const overviewTimers = new Map<number, number>();
/// 탭별로 tail-appended가 마지막으로 알린 총 라인 수.
/// view-update가 먼저 totalLines를 갱신하는 경합이 있어도 pendingNew 증가분을
/// 안정적으로 계산하기 위한 기준선이다.
const lastTailTotal = new Map<number, number>();

export function refreshOverview(id: number, delay = 250) {
  if (overviewTimers.has(id)) return;
  overviewTimers.set(
    id,
    window.setTimeout(async () => {
      overviewTimers.delete(id);
      const { tabs, patchTab } = useStore.getState();
      if (!tabs.some((t) => t.id === id)) return;
      try {
        const { api } = await import("./api");
        const overview = await api.getOverview(id, 120, 160);
        patchTab(id, {
          overview,
          totalLines: overview.totalLines,
          viewLen: overview.viewLen,
          fileSize: overview.fileSize,
          indexing: !overview.indexingDone,
          isJson: overview.json,
        });
      } catch {
        /* 탭이 닫힌 경우 */
      }
    }, delay),
  );
}

export async function wireEvents() {
  const store = () => useStore.getState();

  await listen<IndexProgress>("index-progress", ({ payload: p }) => {
    store().patchTab(p.id, {
      indexing: !p.done,
      indexedLines: p.lines,
      indexedBytes: p.bytes,
      fileSize: p.size,
      totalLines: p.lines,
      ...(p.json !== undefined ? { isJson: p.json } : {}),
    });
    refreshOverview(p.id, p.done ? 50 : 400);
  });

  await listen<TailAppended>("tail-appended", ({ payload: p }) => {
    const s = store();
    const t = s.tabs.find((x) => x.id === p.id);
    if (!t) return;
    const grew = Math.max(0, p.lines - (lastTailTotal.get(p.id) ?? t.totalLines));
    lastTailTotal.set(p.id, p.lines);
    // totalLines 갱신(=렌더)보다 먼저 캐시에 주입해 새 행이 스켈레톤 없이 그려지게 한다
    const injected =
      p.tail !== null && !hasFilter(t) && lineCache.injectTail(p.id, p.tail.start, p.tail.lines, p.tail.gen);
    s.patchTab(p.id, { totalLines: p.lines });
    if (grew > 0) {
      for (const [key, vs] of Object.entries(s.viewStates)) {
        if (key.startsWith(`${p.id}:`) && !vs.follow) {
          s.patchView(key, { pendingNew: vs.pendingNew + grew });
        }
      }
    }
    if (!injected) {
      lineCache.refreshTail(p.id, hasFilter(t) ? t.viewLen : p.lines);
    }
    refreshOverview(p.id, 500);
  });

  await listen<ViewUpdate>("view-update", ({ payload: p }) => {
    const t = store().tabs.find((x) => x.id === p.id);
    if (!t) return;
    const mappingChanged = p.gen !== t.viewGeneration;
    store().patchTab(p.id, {
      viewLen: p.viewLen,
      viewGeneration: p.gen,
      viewComplete: p.done,
      totalLines: p.total,
    });
    if (mappingChanged) {
      lineCache.invalidateAll(p.id);
    } else if (hasFilter(t)) {
      // 무필터 append는 tail-appended 주입이 캐시를 갱신하므로 필터 뷰만 재요청한다
      lineCache.refreshTail(p.id, p.viewLen);
    }
    refreshOverview(p.id, p.done ? 50 : 400);
  });

  await listen<SearchUpdate>("search-update", ({ payload: p }) => {
    const t = store().tabs.find((x) => x.id === p.id);
    if (!t) return;
    store().patchTab(p.id, {
      search: {
        spec: p.cleared ? null : t.search.spec,
        total: p.total,
        done: p.done,
        scanned: p.scanned ?? 0,
        of: p.of ?? 0,
        cursor: p.cleared ? null : t.search.cursor,
        cursorRow: p.cleared ? null : t.search.cursorRow,
      },
    });
    refreshOverview(p.id, p.done ? 50 : 400);
  });

  await listen<{ id: number }>("file-rotated", ({ payload: p }) => {
    const s = store();
    const t = s.tabs.find((x) => x.id === p.id);
    lastTailTotal.delete(p.id);
    lineCache.invalidateAll(p.id);
    s.patchTab(p.id, { selectedLine: null });
    for (const key of Object.keys(s.viewStates)) {
      if (key.startsWith(`${p.id}:`)) s.patchView(key, { pendingNew: 0 });
    }
    s.pushToast(strings().toast.fileReplaced, t ? strings().toast.reindexing(t.name) : undefined);
  });

  await listen<{ id: number; message: string }>("file-error", ({ payload: p }) => {
    store().patchTab(p.id, { fileError: p.message });
  });

  await listen<{ id: number }>("file-recovered", ({ payload: p }) => {
    store().patchTab(p.id, { fileError: null });
    store().pushToast(strings().toast.fileReconnected);
  });

  await getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "drop") {
      for (const path of event.payload.paths) {
        void store().openPath(path);
      }
    }
  });
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    location.reload();
  });
}
