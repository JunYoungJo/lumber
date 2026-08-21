import { api, LineOut } from "./ipc/api";

const CHUNK = 200;
const MAX_CHUNKS = 64;

interface TabCache {
  generation: number;
  chunks: Map<number, LineOut[]>;
  inflight: Set<number>;
  fetchedAt: Map<number, number>;
  /// injectTail이 일어날 때마다 증가 — 주입 이전에 발행된 응답을 식별한다
  seq: number;
}

const caches = new Map<number, TabCache>();
const listeners = new Set<() => void>();
let version = 0;

function cacheOf(tab: number): TabCache {
  let c = caches.get(tab);
  if (!c) {
    c = { generation: -1, chunks: new Map(), inflight: new Set(), fetchedAt: new Map(), seq: 0 };
    caches.set(tab, c);
  }
  return c;
}

function notify() {
  version++;
  listeners.forEach((l) => l());
}

export const lineCache = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  getVersion() {
    return version;
  },
  get(tab: number, row: number): LineOut | undefined {
    const c = caches.get(tab);
    if (!c) return undefined;
    return c.chunks.get(Math.floor(row / CHUNK))?.[row % CHUNK];
  },
  request(tab: number, row: number, force = false) {
    const c = cacheOf(tab);
    const chunk = Math.floor(row / CHUNK);
    if (c.inflight.has(chunk)) return;
    if (!force) {
      const entry = c.chunks.get(chunk);
      const filled = entry !== undefined && row % CHUNK < entry.length;
      if (filled) return;
      // 부분 청크: tail 도중 잘린 응답일 수 있으므로 잠시 후 다시 채운다
      if (entry !== undefined && Date.now() - (c.fetchedAt.get(chunk) ?? 0) < 250) return;
    }
    c.inflight.add(chunk);
    const issuedSeq = c.seq;
    api
      .getLines(tab, chunk * CHUNK, CHUNK)
      .then((res) => {
        if (res.generation !== c.generation) {
          c.generation = res.generation;
          c.chunks.clear();
        } else {
          // 요청 발행 후 injectTail이 있었다면 응답이 주입분보다 낡았을 수 있다.
          // 기존 데이터가 더 길면(주입으로 연장) 응답을 버려 되감김 깜빡임을 막는다.
          const prev = c.chunks.get(chunk);
          if (issuedSeq !== c.seq && prev !== undefined && prev.length >= res.lines.length) {
            c.fetchedAt.set(chunk, Date.now());
            notify();
            return;
          }
        }
        c.chunks.set(chunk, res.lines);
        c.fetchedAt.set(chunk, Date.now());
        while (c.chunks.size > MAX_CHUNKS) {
          const oldest = c.chunks.keys().next().value;
          if (oldest === undefined) break;
          c.chunks.delete(oldest);
          c.fetchedAt.delete(oldest);
        }
        notify();
      })
      .catch(() => {})
      .finally(() => {
        c.inflight.delete(chunk);
      });
  },
  /// tail-appended 이벤트로 푸시된 라인을 캐시에 직접 주입한다(IPC 왕복 제거).
  /// start 지점부터 기존 청크를 잘라내고 이어 붙이므로 되감긴(rolled-back)
  /// 열린 라인도 함께 갱신된다. 선행 데이터가 없는 구간은 청크 경계까지
  /// 건너뛴다. 주입 성공 여부를 반환하며, false면 호출자가 refreshTail로
  /// 폴백해야 한다.
  injectTail(tab: number, start: number, lines: LineOut[], generation: number): boolean {
    if (lines.length === 0) return true;
    const c = cacheOf(tab);
    if (c.generation === -1) c.generation = generation;
    else if (c.generation !== generation) return false;
    c.seq++;
    let wrote = false;
    let i = 0;
    while (i < lines.length) {
      const row = start + i;
      const chunk = Math.floor(row / CHUNK);
      const off = row % CHUNK;
      let entry = c.chunks.get(chunk);
      if (entry === undefined) {
        if (off !== 0) {
          i += CHUNK - off;
          continue;
        }
        entry = [];
        c.chunks.set(chunk, entry);
      } else if (entry.length < off) {
        i += CHUNK - off;
        continue;
      }
      entry.length = off;
      const take = Math.min(lines.length - i, CHUNK - off);
      for (let k = 0; k < take; k++) entry.push(lines[i + k]);
      c.fetchedAt.set(chunk, Date.now());
      wrote = true;
      i += take;
    }
    while (c.chunks.size > MAX_CHUNKS) {
      const oldest = c.chunks.keys().next().value;
      if (oldest === undefined) break;
      c.chunks.delete(oldest);
      c.fetchedAt.delete(oldest);
    }
    if (wrote) notify();
    return wrote;
  },
  /// tail append 반영: 마지막 청크를 기존 데이터 유지 상태로 재요청(SWR).
  /// 삭제 후 재요청하면 스켈레톤이 노출되어 화면이 깜빡인다.
  refreshTail(tab: number, totalRows: number) {
    if (totalRows <= 0) return;
    const lastRow = totalRows - 1;
    this.request(tab, lastRow, true);
    if (lastRow >= CHUNK && lastRow % CHUNK < CHUNK / 4) {
      this.request(tab, lastRow - CHUNK, true);
    }
  },
  invalidateAll(tab: number) {
    const c = caches.get(tab);
    if (!c) return;
    c.chunks.clear();
    c.inflight.clear();
    c.fetchedAt.clear();
    notify();
  },
  drop(tab: number) {
    caches.delete(tab);
  },
};

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    location.reload();
  });
}
