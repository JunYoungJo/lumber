// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store";
import { LogList } from "./LogList";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({ id: 1, path: "/test.log", name: "test.log" })),
}));
vi.mock("../controller", () => ({ registerBus: vi.fn(), unregisterBus: vi.fn() }));
vi.mock("../ipc/events", () => ({ refreshOverview: vi.fn() }));
vi.mock("../lineCache", () => ({
  lineCache: {
    subscribe: () => () => {},
    getVersion: () => 0,
    get: (_tab: number, row: number) => ({ row, line: row, text: "long message ".repeat(40), level: 3, ts: null }),
  },
}));

// happy-dom에는 레이아웃 엔진이 없으므로 높이와 스크롤 경계만 제공한다.
// React, virtualizer, store, follower는 실제 구현을 사용한다.
const positions = new WeakMap<HTMLElement, number>();
const observers = new Set<TestResizeObserver>();
class TestResizeObserver {
  targets = new Set<HTMLElement>();
  constructor(private callback: ResizeObserverCallback) { observers.add(this); }
  observe(target: HTMLElement) { this.targets.add(target); }
  unobserve(target: HTMLElement) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); observers.delete(this); }
  flush() {
    const entries = [...this.targets].filter((el) => el.isConnected).map((target) => ({
      target,
      borderBoxSize: [{ inlineSize: target.offsetWidth, blockSize: target.offsetHeight }],
    } as unknown as ResizeObserverEntry));
    if (entries.length) this.callback(entries, this as unknown as ResizeObserver);
  }
}

let root: Root;
let host: HTMLDivElement;
const viewKey = "1:1";
const state = () => useStore.getState();
const view = () => state().viewStates[viewKey];
const list = () => host.querySelector<HTMLDivElement>(".loglist")!;
function topRow(el: HTMLElement) {
  return [...el.querySelectorAll<HTMLElement>(".row")].find((row) => {
    const top = Number(row.style.transform.match(/translateY\(([-.\d]+)px\)/)?.[1]);
    return top <= el.scrollTop && top + row.offsetHeight > el.scrollTop;
  })?.dataset.index;
}

async function frames(count = 30) {
  for (let i = 0; i < count; i++) {
    await act(async () => {
      observers.forEach((o) => o.flush());
      await vi.advanceTimersByTimeAsync(17);
    });
  }
}

async function toggle(wrap: boolean) {
  await act(async () => state().patchTab(1, { wrap }));
  await frames();
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("loglist") ? 480 : this.classList.contains("wrap") ? 72 : 24;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this.offsetHeight; });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    return Number.parseFloat((this.firstElementChild as HTMLElement)?.style.height || "0");
  });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(function (this: HTMLElement) {
    return Math.min(positions.get(this) ?? 0, Math.max(0, this.scrollHeight - this.clientHeight));
  });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(function (this: HTMLElement, value: number) {
    const next = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
    if (next === this.scrollTop) return;
    positions.set(this, next);
    setTimeout(() => this.dispatchEvent(new Event("scroll")), 0);
  });
  vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === "object") this.scrollTop = options.top ?? 0;
  });
  await state().openPath("/test.log");
  state().patchTab(1, { totalLines: 2000 });
  useStore.setState({ viewStates: { [viewKey]: { follow: false, pendingNew: 3, scrollTop: 0 } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<LogList viewKey={viewKey} tabId={1} />));
  await frames();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  observers.clear();
  useStore.setState({ tabs: [], viewStates: {}, paneTrees: {} });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("줄바꿈 전환 시 스크롤과 follow", () => {
  it("중간 위치에서 전환해도 읽던 행과 탭 복원 위치를 유지한다", async () => {
    const el = list();
    await act(async () => { el.scrollTop = 12000; });
    await frames();
    for (const wrap of [true, false, true, false]) {
      await toggle(wrap);
      expect(topRow(list())).toBe("500");
      expect(view().follow).toBe(false);
    }
    expect(list().scrollTop).toBe(12000);
    expect(view().pendingNew).toBe(3);
    await act(async () => root.unmount());
    expect(view().scrollTop).toBe(12000);
    root = createRoot(host);
    await act(async () => root.render(<LogList viewKey={viewKey} tabId={1} />));
    await frames();
    expect(list().scrollTop).toBe(12000);
  });

  it("follow 중 반복 전환해도 follow와 하단 추적을 유지한다", async () => {
    await act(async () => state().patchView(viewKey, { follow: true, pendingNew: 0 }));
    await frames(80);
    const lostFollow: boolean[] = [];
    const unsubscribe = useStore.subscribe((s) => {
      if (!s.viewStates[viewKey]?.follow) lostFollow.push(true);
    });
    for (const wrap of [true, false, true, false]) {
      await toggle(wrap);
      await frames(80);
      expect(view().follow).toBe(true);
      expect(list().scrollTop).toBeCloseTo(list().scrollHeight - list().clientHeight, 0);
    }
    await act(async () => state().patchTab(1, { totalLines: 2010 }));
    await frames(80);
    expect(view().follow).toBe(true);
    expect(list().scrollTop).toBeCloseTo(list().scrollHeight - list().clientHeight, 0);
    unsubscribe();
    expect(lostFollow).toEqual([]);
    await act(async () => list().dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true })));
    expect(view().follow).toBe(false);
  });

  it("같은 탭의 분할 화면에서 읽는 위치와 follow 상태를 각각 유지한다", async () => {
    const followingKey = "1:2";
    await act(async () => {
      useStore.setState({ viewStates: {
        ...state().viewStates,
        [followingKey]: { follow: true, pendingNew: 0, scrollTop: 0 },
      } });
      root.render(<><LogList viewKey={viewKey} tabId={1} /><LogList viewKey={followingKey} tabId={1} /></>);
    });
    await frames(80);
    const [reading, following] = [...host.querySelectorAll<HTMLDivElement>(".loglist")];
    await act(async () => { reading.scrollTop = 12000; });
    await frames();
    for (const wrap of [true, false]) {
      await toggle(wrap);
      await frames(80);
      expect(topRow(reading)).toBe("500");
      expect(view().follow).toBe(false);
      expect(state().viewStates[followingKey].follow).toBe(true);
      expect(following.scrollTop).toBeCloseTo(following.scrollHeight - following.clientHeight, 0);
    }
  });
});
