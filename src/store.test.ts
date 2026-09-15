import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => {
  const ids = new Map<string, number>();
  return {
    invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === "open_file") {
        const path = String(args.path);
        if (!ids.has(path)) ids.set(path, ids.size + 1);
        return { id: ids.get(path), path, name: path.split("/").pop() };
      }
      return null;
    }),
  };
});

const mem = new Map<string, string>();

beforeAll(() => {
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  };
  (globalThis as Record<string, unknown>).document = { documentElement: { dataset: {} } };
});

async function fresh() {
  vi.resetModules();
  const mod = await import("./store");
  return mod;
}

describe("buildFilterSpec", () => {
  it("필터가 없으면 null", async () => {
    const { buildFilterSpec, useStore } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    const t = useStore.getState().tabs[0];
    expect(buildFilterSpec(t)).toBeNull();
  });

  it("레벨 제외 시 허용 레벨 목록 생성", async () => {
    const { buildFilterSpec, useStore } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    useStore.getState().patchTab(1, { levelsOff: [2, 3] });
    const spec = buildFilterSpec(useStore.getState().tabs[0])!;
    expect(spec.levels).toEqual([0, 1, 4, 5, 6]);
  });

  it("포함/제외/필드 조합", async () => {
    const { buildFilterSpec, useStore } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    useStore.getState().patchTab(1, {
      includes: ["timeout"],
      excludes: ["healthz"],
      fields: [{ key: "service", value: "api" }],
    });
    const spec = buildFilterSpec(useStore.getState().tabs[0])!;
    expect(spec.includes).toEqual([{ pattern: "timeout", regex: false, case_sensitive: false }]);
    expect(spec.exclude?.pattern).toBe("healthz");
    expect(spec.fields).toHaveLength(1);
  });

  it("포함 필터 누적은 AND, 항목 안의 |는 OR", async () => {
    const { buildFilterSpec, useStore } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    useStore.getState().patchTab(1, { includes: ["apple", "[RECV]|[SEND]"], includeDraft: "" });
    const spec = buildFilterSpec(useStore.getState().tabs[0])!;
    expect(spec.includes).toHaveLength(2);
    const res = spec.includes!.map((p) => new RegExp(p.regex ? p.pattern : p.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    const passes = (line: string) => res.every((re) => re.test(line));
    expect(passes("apple [RECV] data")).toBe(true);
    expect(passes("apple [SEND] data")).toBe(true);
    expect(passes("apple only")).toBe(false);
    expect(passes("[RECV] no fruit")).toBe(false);
  });
});

describe("toPatternSpec (| OR 해석)", () => {
  it("|가 있으면 이스케이프된 정규식 OR로 변환한다", async () => {
    const { toPatternSpec } = await fresh();
    const spec = toPatternSpec("[RECV]|[SEND]", false);
    expect(spec.regex).toBe(true);
    expect(spec.pattern).toBe("\\[RECV\\]|\\[SEND\\]");
    expect(new RegExp(spec.pattern, "i").test("12:00 [RECV] data")).toBe(true);
    expect(new RegExp(spec.pattern, "i").test("12:00 [send] data")).toBe(true);
    expect(new RegExp(spec.pattern, "i").test("12:00 [OTHER] data")).toBe(false);
  });

  it("단일 항목은 일반 텍스트 그대로 둔다", async () => {
    const { toPatternSpec } = await fresh();
    expect(toPatternSpec("timeout", false)).toEqual({ pattern: "timeout", regex: false, case_sensitive: false });
    expect(toPatternSpec("a| ", false).regex).toBe(false);
  });

  it("정규식 모드는 그대로 통과시킨다", async () => {
    const { toPatternSpec } = await fresh();
    expect(toPatternSpec("a|b", true)).toEqual({ pattern: "a|b", regex: true, case_sensitive: false });
  });
});

describe("store actions", () => {
  beforeEach(() => mem.clear());

  it("toggleLevel은 레벨 그룹 단위로 토글한다", async () => {
    const { useStore } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    useStore.getState().toggleLevel(1, [5, 6]);
    expect(useStore.getState().tabs[0].levelsOff).toEqual([5, 6]);
    useStore.getState().toggleLevel(1, [3]);
    expect(useStore.getState().tabs[0].levelsOff).toEqual([5, 6, 3]);
    useStore.getState().toggleLevel(1, [5, 6]);
    expect(useStore.getState().tabs[0].levelsOff).toEqual([3]);
  });

  it("toggleBookmark는 라인 순서를 유지하며 추가/제거한다", async () => {
    const { useStore } = await fresh();
    useStore.getState().toggleBookmark("p", 30, "b");
    useStore.getState().toggleBookmark("p", 10, "a");
    expect(useStore.getState().bookmarks["p"].map((b) => b.line)).toEqual([10, 30]);
    useStore.getState().toggleBookmark("p", 30, "b");
    expect(useStore.getState().bookmarks["p"].map((b) => b.line)).toEqual([10]);
  });

  it("openPath는 탭을 추가하고 최근 목록을 갱신한다", async () => {
    const { useStore } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    expect(useStore.getState().tabs).toHaveLength(1);
    expect(useStore.getState().activeId).toBe(1);
    expect(useStore.getState().recents[0]).toBe("C:/a.log");
  });

  it("cycleTab은 그룹 안에서 탭을 순환한다", async () => {
    const { useStore } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    await useStore.getState().openPath("C:/b.log");
    expect(useStore.getState().activeId).toBe(2);
    useStore.getState().cycleTab(1);
    expect(useStore.getState().activeId).toBe(1);
    useStore.getState().cycleTab(1);
    expect(useStore.getState().activeId).toBe(2);
    useStore.getState().cycleTab(-1);
    expect(useStore.getState().activeId).toBe(1);
  });

  it("moveTabToSplit은 탭을 새 그룹으로 옮긴다", async () => {
    const { useStore, groupLeaves } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    await useStore.getState().openPath("C:/b.log");
    useStore.getState().moveTabToSplit(2, "row");
    const groups = groupLeaves(useStore.getState().groupTree);
    expect(groups).toHaveLength(2);
    expect(groups[0].data.tabIds).toEqual([1]);
    expect(groups[1].data.tabIds).toEqual([2]);
    useStore.getState().closeTab(2);
    expect(groupLeaves(useStore.getState().groupTree)).toHaveLength(1);
  });

  it("dropTabOnGroup center는 분할 없이 대상 그룹에 합류시킨다", async () => {
    const { useStore, groupLeaves } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    await useStore.getState().openPath("C:/b.log");
    useStore.getState().moveTabToSplit(2, "row");
    expect(groupLeaves(useStore.getState().groupTree)).toHaveLength(2);

    const first = groupLeaves(useStore.getState().groupTree)[0];
    useStore.getState().dropTabOnGroup(2, first.id, "center");
    const groups = groupLeaves(useStore.getState().groupTree);
    expect(groups).toHaveLength(1);
    expect(groups[0].data.tabIds).toEqual([1, 2]);
    expect(groups[0].data.activeTabId).toBe(2);
  });

  it("dropTabOnGroup right는 대상 오른쪽에 새 그룹을 만든다", async () => {
    const { useStore, groupLeaves } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    await useStore.getState().openPath("C:/b.log");
    const g = groupLeaves(useStore.getState().groupTree)[0];
    useStore.getState().dropTabOnGroup(2, g.id, "right");
    const groups = groupLeaves(useStore.getState().groupTree);
    expect(groups).toHaveLength(2);
    expect(groups[0].data.tabIds).toEqual([1]);
    expect(groups[1].data.tabIds).toEqual([2]);
  });

  it("dropTabOnGroup left는 대상 왼쪽에 새 그룹을 만든다", async () => {
    const { useStore, groupLeaves } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    await useStore.getState().openPath("C:/b.log");
    const g = groupLeaves(useStore.getState().groupTree)[0];
    useStore.getState().dropTabOnGroup(2, g.id, "left");
    const groups = groupLeaves(useStore.getState().groupTree);
    expect(groups).toHaveLength(2);
    expect(groups[0].data.tabIds).toEqual([2]);
    expect(groups[1].data.tabIds).toEqual([1]);
  });

  it("dropTabOnGroup bottom은 세로로 쪼갠다", async () => {
    const { useStore, groupLeaves } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    await useStore.getState().openPath("C:/b.log");
    const g = groupLeaves(useStore.getState().groupTree)[0];
    useStore.getState().dropTabOnGroup(2, g.id, "bottom");
    const tree = useStore.getState().groupTree;
    if (tree.kind !== "split") throw new Error("split 아님");
    expect(tree.dir).toBe("col");
    expect(groupLeaves(tree).map((l) => l.data.tabIds)).toEqual([[1], [2]]);
  });

  it("옮겨서 원래 그룹이 비면 그 그룹은 사라진다", async () => {
    const { useStore, groupLeaves } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    await useStore.getState().openPath("C:/b.log");
    useStore.getState().moveTabToSplit(2, "row");
    const first = groupLeaves(useStore.getState().groupTree)[0];
    // 2번만 있던 그룹이 비므로 걷힌다
    useStore.getState().dropTabOnGroup(2, first.id, "center");
    expect(groupLeaves(useStore.getState().groupTree)).toHaveLength(1);
  });

  it("탭이 하나뿐인 자기 그룹에 떨어뜨리면 아무 일도 없다", async () => {
    const { useStore, groupLeaves } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    const g = groupLeaves(useStore.getState().groupTree)[0];
    const before = useStore.getState().groupTree;
    useStore.getState().dropTabOnGroup(1, g.id, "right");
    expect(useStore.getState().groupTree).toBe(before);
    expect(groupLeaves(useStore.getState().groupTree)).toHaveLength(1);
  });

  it("자기 그룹 center에 떨어뜨리면 제자리라 아무 일도 없다", async () => {
    const { useStore, groupLeaves } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    await useStore.getState().openPath("C:/b.log");
    const g = groupLeaves(useStore.getState().groupTree)[0];
    const before = useStore.getState().groupTree;
    useStore.getState().dropTabOnGroup(2, g.id, "center");
    expect(useStore.getState().groupTree).toBe(before);
  });

  it("reorderTabInGroup은 같은 그룹 안에서 순서를 바꾼다", async () => {
    const { useStore, groupLeaves } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    await useStore.getState().openPath("C:/b.log");
    await useStore.getState().openPath("C:/c.log");
    const g = groupLeaves(useStore.getState().groupTree)[0];
    expect(g.data.tabIds).toEqual([1, 2, 3]);
    useStore.getState().reorderTabInGroup(g.id, 3, 1);
    expect(groupLeaves(useStore.getState().groupTree)[0].data.tabIds).toEqual([1, 3, 2]);
  });

  it("reorderTabInGroup은 그룹에 없는 탭을 무시한다", async () => {
    const { useStore, groupLeaves } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    const g = groupLeaves(useStore.getState().groupTree)[0];
    const before = useStore.getState().groupTree;
    useStore.getState().reorderTabInGroup(g.id, 99, 0);
    expect(useStore.getState().groupTree).toBe(before);
  });

  it("closeTab은 다음 탭을 활성화한다", async () => {
    const { useStore } = await fresh();
    await useStore.getState().openPath("C:/a.log");
    useStore.getState().closeTab(1);
    expect(useStore.getState().tabs).toHaveLength(0);
    expect(useStore.getState().activeId).toBeNull();
  });
});
