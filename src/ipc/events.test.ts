import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (e: { payload: unknown }) => void>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(name, cb);
    return () => {};
  }),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "open_file") return { id: 1, path: String(args.path), name: "a.log" };
    return null;
  }),
}));

const mem = new Map<string, string>();

beforeAll(() => {
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  };
  (globalThis as Record<string, unknown>).document = { documentElement: { dataset: {} } };
  (globalThis as Record<string, unknown>).window = globalThis;
});

async function setup() {
  vi.resetModules();
  handlers.clear();
  const { useStore } = await import("../store");
  const { wireEvents } = await import("./events");
  await wireEvents();
  await useStore.getState().openPath("C:/a.log");
  const key = Object.keys(useStore.getState().viewStates)[0];
  return { useStore, key };
}

function emit(name: string, payload: unknown) {
  const h = handlers.get(name);
  if (!h) throw new Error(`no handler for ${name}`);
  h({ payload });
}

describe("tail-appended pendingNew", () => {
  beforeEach(() => {
    mem.clear();
  });

  it("view-update가 먼저 totalLines를 갱신해도 새 라인 수를 pendingNew에 더한다", async () => {
    const { useStore, key } = await setup();
    useStore.getState().patchView(key, { follow: false, pendingNew: 0 });
    useStore.getState().patchTab(1, { totalLines: 100 });
    emit("tail-appended", { id: 1, lines: 100, rolledBackTo: 100, tail: null });

    // 경합 재현: view-update가 tail-appended보다 먼저 도착해 totalLines를 선반영
    emit("view-update", { id: 1, gen: 0, viewLen: 120, total: 120, done: true });
    emit("tail-appended", { id: 1, lines: 120, rolledBackTo: 100, tail: null });

    expect(useStore.getState().viewStates[key].pendingNew).toBe(20);
  });

  it("follow 중인 뷰는 pendingNew를 올리지 않는다", async () => {
    const { useStore, key } = await setup();
    useStore.getState().patchView(key, { follow: true, pendingNew: 0 });
    useStore.getState().patchTab(1, { totalLines: 100 });
    emit("tail-appended", { id: 1, lines: 100, rolledBackTo: 100, tail: null });

    emit("tail-appended", { id: 1, lines: 130, rolledBackTo: 100, tail: null });

    expect(useStore.getState().viewStates[key].pendingNew).toBe(0);
  });

  it("파일 로테이션 후에는 새 기준으로 다시 센다", async () => {
    const { useStore, key } = await setup();
    useStore.getState().patchView(key, { follow: false, pendingNew: 0 });
    useStore.getState().patchTab(1, { totalLines: 500 });
    emit("tail-appended", { id: 1, lines: 500, rolledBackTo: 500, tail: null });

    emit("file-rotated", { id: 1 });
    useStore.getState().patchTab(1, { totalLines: 10 });
    emit("tail-appended", { id: 1, lines: 15, rolledBackTo: 10, tail: null });

    expect(useStore.getState().viewStates[key].pendingNew).toBe(5);
  });
});
