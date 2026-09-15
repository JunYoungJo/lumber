/// 탭을 pane 위로 끌었을 때 어느 구역에 놓이는지 판정한다.
/// 상호작용에서 떼어낸 순수 계산이라 단위 테스트로 덮을 수 있다.

export type Zone = "center" | "left" | "right" | "top" | "bottom";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/// 각 변에서 안쪽으로 이만큼까지가 가장자리 구역이다. 축마다 따로 적용하므로
/// 가로로 긴 pane은 좌우 띠가 넓고 상하 띠가 좁다.
export const EDGE_RATIO = 0.25;

export function dropZone(r: Rect, p: Point): Zone | null {
  const x = p.x - r.left;
  const y = p.y - r.top;
  if (x < 0 || y < 0 || x > r.width || y > r.height) return null;

  const wBand = r.width * EDGE_RATIO;
  const hBand = r.height * EDGE_RATIO;

  // 각 변까지의 거리를 띠 폭으로 정규화해 비교한다. 그래야 모서리에서
  // "더 가까운 변"이 pane 비율과 무관하게 일관되게 정해진다.
  const cands: { zone: Zone; score: number }[] = [];
  if (x < wBand) cands.push({ zone: "left", score: x / wBand });
  if (r.width - x < wBand) cands.push({ zone: "right", score: (r.width - x) / wBand });
  if (y < hBand) cands.push({ zone: "top", score: y / hBand });
  if (r.height - y < hBand) cands.push({ zone: "bottom", score: (r.height - y) / hBand });

  if (cands.length === 0) return "center";
  return cands.reduce((a, b) => (b.score < a.score ? b : a)).zone;
}

/// 미리보기 블록이 차지할 영역. 가장자리는 절반, 가운데는 전체.
export function zoneRect(r: Rect, zone: Zone): Rect {
  const halfW = r.width / 2;
  const halfH = r.height / 2;
  switch (zone) {
    case "left":
      return { left: r.left, top: r.top, width: halfW, height: r.height };
    case "right":
      return { left: r.left + halfW, top: r.top, width: halfW, height: r.height };
    case "top":
      return { left: r.left, top: r.top, width: r.width, height: halfH };
    case "bottom":
      return { left: r.left, top: r.top + halfH, width: r.width, height: halfH };
    case "center":
      return { ...r };
  }
}
