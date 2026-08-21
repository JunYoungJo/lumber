import { describe, expect, it } from "vitest";
import { findLeaf, leaf, leaves, removeLeaf, splitLeaf, TreeNode } from "./splitTree";

describe("splitTree", () => {
  it("리프 분할은 같은 방향이면 형제로 삽입된다", () => {
    let t: TreeNode<string> = leaf(1, "a");
    t = splitLeaf(t, 1, "row", leaf(2, "b"), 100);
    expect(t.kind).toBe("split");
    t = splitLeaf(t, 2, "row", leaf(3, "c"), 101);
    if (t.kind !== "split") throw new Error("split 아님");
    expect(t.children).toHaveLength(3);
    expect(leaves(t).map((l) => l.data)).toEqual(["a", "b", "c"]);
    expect(t.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("다른 방향 분할은 중첩 split을 만든다", () => {
    let t: TreeNode<string> = leaf(1, "a");
    t = splitLeaf(t, 1, "row", leaf(2, "b"), 100);
    t = splitLeaf(t, 2, "col", leaf(3, "c"), 101);
    if (t.kind !== "split") throw new Error("split 아님");
    expect(t.dir).toBe("row");
    const second = t.children[1];
    if (second.kind !== "split") throw new Error("중첩 split 아님");
    expect(second.dir).toBe("col");
    expect(leaves(t).map((l) => l.data)).toEqual(["a", "b", "c"]);
  });

  it("리프 제거 시 자식 하나 남은 split은 접힌다", () => {
    let t: TreeNode<string> = leaf(1, "a");
    t = splitLeaf(t, 1, "row", leaf(2, "b"), 100);
    t = splitLeaf(t, 2, "col", leaf(3, "c"), 101);
    const after = removeLeaf(t, 3)!;
    expect(leaves(after).map((l) => l.data)).toEqual(["a", "b"]);
    const again = removeLeaf(after, 2)!;
    expect(again.kind).toBe("leaf");
    expect(findLeaf(again, 1)?.data).toBe("a");
  });

  it("마지막 리프 제거는 null", () => {
    const t: TreeNode<string> = leaf(1, "a");
    expect(removeLeaf(t, 1)).toBeNull();
  });
});
