/// follow 모드에서 스크롤을 바닥에 "던지지" 않고 부드럽게 추적하기 위한 스테퍼.
/// rAF마다 step()을 호출하면 잔여 거리에 비례해 이동한다(지수 감쇠).
export interface FollowerIO {
  scrollTop(): number;
  setScrollTop(v: number): void;
  /// scrollHeight - clientHeight
  maxScroll(): number;
  /// clientHeight
  viewport(): number;
}

export type FollowStep = "idle" | "moving" | "interrupted";

/// 잔여 거리가 e배 줄어드는 시간상수(ms). 작을수록 빠르게 붙는다.
const TAU_MS = 120;
/// 수렴 보장을 위한 프레임당 최소 이동량(px).
const MIN_STEP = 2;
/// 이 배수(뷰포트 기준)보다 멀면 한 뷰포트 앞으로 즉시 점프한 뒤 활강한다.
const SNAP_VIEWPORTS = 2.5;
/// 직전에 쓴 값보다 이만큼 이상 위로 가 있으면 사용자 개입으로 본다(px).
const INTERRUPT_EPS = 4;

export class SmoothFollower {
  private lastWritten: number | null = null;

  constructor(private io: FollowerIO) {}

  /// 개입 감지 기준점을 버린다(탭 전환·명시적 점프 직후 호출).
  reset() {
    this.lastWritten = null;
  }

  step(dtMs: number): FollowStep {
    const cur = this.io.scrollTop();
    const target = this.io.maxScroll();
    // 줄바꿈 해제 등으로 높이가 줄면 브라우저가 새 스크롤 하단으로 보정한다.
    // 이전 하단과의 차이는 사용자 개입이 아니므로 새 하단을 기준으로 비교한다.
    if (this.lastWritten !== null && cur < Math.min(this.lastWritten, target) - INTERRUPT_EPS) {
      this.lastWritten = null;
      return "interrupted";
    }
    const dist = target - cur;
    if (dist <= 0.5) {
      this.lastWritten = cur;
      return "idle";
    }
    const vp = this.io.viewport();
    let next: number;
    if (dist > vp * SNAP_VIEWPORTS) {
      next = target - vp;
    } else if (dist <= MIN_STEP * 2) {
      next = target;
    } else {
      const k = 1 - Math.exp(-dtMs / TAU_MS);
      next = Math.min(target, cur + Math.max(MIN_STEP, dist * k));
    }
    this.io.setScrollTop(next);
    this.lastWritten = next;
    return "moving";
  }
}
