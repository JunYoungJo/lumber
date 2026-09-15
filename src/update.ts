import { create } from "zustand";

export type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

export type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

/// 업데이트 한 건. 실제 구현은 플러그인의 Update 객체를 감싸고, 테스트는 가짜를 넣는다.
export interface UpdateHandle {
  version: string;
  notes: string | null;
  downloadAndInstall(onProgress: (e: DownloadEvent) => void): Promise<void>;
}

/// 바깥 세계(Tauri 플러그인)와 닿는 유일한 지점. src/follower.ts의 FollowerIO와 같은 방식.
export interface UpdaterIO {
  check(): Promise<UpdateHandle | null>;
  relaunch(): Promise<void>;
}

// 플러그인 모듈은 브라우저/vitest 환경에서 불러올 수 없으므로 호출 시점에 동적으로 import한다.
// Palette.tsx가 ../ipc/api를 다루는 방식과 같다.
const tauriIO: UpdaterIO = {
  async check() {
    const { check } = await import("@tauri-apps/plugin-updater");
    const u = await check();
    if (!u) return null;
    return {
      version: u.version,
      notes: u.body ?? null,
      downloadAndInstall: (onProgress) => u.downloadAndInstall(onProgress),
    };
  },
  async relaunch() {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  },
};

let io: UpdaterIO = tauriIO;
let pending: UpdateHandle | null = null;

/// 테스트 전용. 프로덕션 코드에서 부르지 않는다.
export function setUpdaterIO(next: UpdaterIO): void {
  io = next;
}

export interface UpdateState {
  phase: UpdatePhase;
  version: string | null;
  notes: string | null;
  downloaded: number;
  total: number;
  error: string | null;
  popoverOpen: boolean;
  setPopoverOpen(v: boolean): void;
  check(manual: boolean): Promise<void>;
  install(): Promise<void>;
  restart(): Promise<void>;
  reset(): void;
}

const INITIAL = {
  phase: "idle" as UpdatePhase,
  version: null as string | null,
  notes: null as string | null,
  downloaded: 0,
  total: 0,
  error: null as string | null,
  popoverOpen: false,
};

export const useUpdate = create<UpdateState>((set, get) => ({
  ...INITIAL,

  setPopoverOpen: (v) => set({ popoverOpen: v }),

  reset: () => {
    pending = null;
    set({ ...INITIAL });
  },

  async check(manual) {
    const phase = get().phase;
    if (phase === "checking" || phase === "downloading") return;
    set({ phase: "checking", error: null });
    // 수동 확인은 "확인 중"과 "최신 버전입니다"를 보여줄 곳이 필요하다. 자동 확인은 조용해야 한다.
    if (manual) set({ popoverOpen: true });
    try {
      const u = await io.check();
      if (!u) {
        pending = null;
        set({ phase: "idle", version: null, notes: null });
        return;
      }
      pending = u;
      set({ phase: "available", version: u.version, notes: u.notes });
    } catch (e) {
      // 오프라인·프록시·GitHub 장애는 흔하다. 요청하지 않은 사용자를 방해하지 않는다.
      if (manual) set({ phase: "error", error: String(e) });
      else set({ phase: "idle", error: null });
    }
  },

  async install() {
    if (!pending || get().phase !== "available") return;
    set({ phase: "downloading", downloaded: 0, total: 0, error: null });
    try {
      await pending.downloadAndInstall((e) => {
        if (e.event === "Started") set({ total: e.data.contentLength ?? 0 });
        else if (e.event === "Progress") set({ downloaded: get().downloaded + e.data.chunkLength });
      });
      // 다운로드가 끝나도 바로 재시작하지 않는다. 로그를 읽는 중에 창이 사라지면 안 된다.
      set({ phase: "ready" });
    } catch (e) {
      set({ phase: "error", error: String(e) });
    }
  },

  async restart() {
    await io.relaunch();
  },
}));

/// 배지를 그릴지. checking/idle은 알릴 가치가 없어 숨기되, 수동 확인으로 팝오버가 열려 있으면
/// 팝오버의 기준점이 필요하므로 보인다.
export function badgeVisible(s: UpdateState): boolean {
  if (s.popoverOpen) return true;
  return s.phase === "available" || s.phase === "downloading" || s.phase === "ready" || s.phase === "error";
}
