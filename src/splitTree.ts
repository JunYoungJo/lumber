export type SplitDir = "row" | "col";

export interface TreeLeaf<T> {
  kind: "leaf";
  id: number;
  data: T;
}

export interface TreeSplit<T> {
  kind: "split";
  id: number;
  dir: SplitDir;
  children: TreeNode<T>[];
  sizes: number[];
}

export type TreeNode<T> = TreeLeaf<T> | TreeSplit<T>;

export function leaf<T>(id: number, data: T): TreeLeaf<T> {
  return { kind: "leaf", id, data };
}

export function leaves<T>(node: TreeNode<T>): TreeLeaf<T>[] {
  if (node.kind === "leaf") return [node];
  return node.children.flatMap(leaves);
}

export function findLeaf<T>(node: TreeNode<T>, id: number): TreeLeaf<T> | null {
  return leaves(node).find((l) => l.id === id) ?? null;
}

export function updateLeaf<T>(node: TreeNode<T>, id: number, data: T): TreeNode<T> {
  if (node.kind === "leaf") {
    return node.id === id ? { ...node, data } : node;
  }
  return { ...node, children: node.children.map((c) => updateLeaf(c, id, data)) };
}

/// target 리프를 dir 방향으로 분할해 newLeaf를 뒤에 붙인다.
/// 부모 split의 방향이 같으면 형제로 삽입하고, 다르면 새 split으로 감싼다.
export function splitLeaf<T>(
  node: TreeNode<T>,
  targetId: number,
  dir: SplitDir,
  newLeaf: TreeLeaf<T>,
  splitId: number,
): TreeNode<T> {
  if (node.kind === "leaf") {
    if (node.id !== targetId) return node;
    return { kind: "split", id: splitId, dir, children: [node, newLeaf], sizes: [0.5, 0.5] };
  }
  const idx = node.children.findIndex((c) => c.kind === "leaf" && c.id === targetId);
  if (idx >= 0 && node.dir === dir) {
    const children = [...node.children];
    children.splice(idx + 1, 0, newLeaf);
    const shrink = node.sizes[idx] / 2;
    const sizes = [...node.sizes];
    sizes[idx] = shrink;
    sizes.splice(idx + 1, 0, shrink);
    return { ...node, children, sizes };
  }
  return { ...node, children: node.children.map((c) => splitLeaf(c, targetId, dir, newLeaf, splitId)) };
}

/// 리프를 제거하고, 자식이 하나 남은 split은 그 자식으로 대체한다.
export function removeLeaf<T>(node: TreeNode<T>, targetId: number): TreeNode<T> | null {
  if (node.kind === "leaf") {
    return node.id === targetId ? null : node;
  }
  const children: TreeNode<T>[] = [];
  const sizes: number[] = [];
  node.children.forEach((c, i) => {
    const next = removeLeaf(c, targetId);
    if (next !== null) {
      children.push(next);
      sizes.push(node.sizes[i]);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  const total = sizes.reduce((a, b) => a + b, 0);
  return { ...node, children, sizes: sizes.map((s) => s / total) };
}

export function setSizes<T>(node: TreeNode<T>, splitId: number, sizes: number[]): TreeNode<T> {
  if (node.kind === "leaf") return node;
  if (node.id === splitId) return { ...node, sizes };
  return { ...node, children: node.children.map((c) => setSizes(c, splitId, sizes)) };
}
