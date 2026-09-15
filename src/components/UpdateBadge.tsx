import { fmtBytes } from "../format";
import { useStrings } from "../i18n/useStrings";
import { badgeVisible, useUpdate } from "../update";

// 스토어가 작고 배지가 거의 모든 필드를 읽으므로 선택자 없이 통째로 구독한다.
// 업데이트 상태는 초당 수십 번 바뀌지 않아 재렌더 비용이 문제되지 않는다.
export function UpdateBadge() {
  const s = useUpdate();
  const S = useStrings();
  if (!badgeVisible(s)) return null;

  const known = s.total > 0;
  const pct = known ? Math.min(100, Math.round((s.downloaded / s.total) * 100)) : 0;

  const label =
    s.phase === "downloading" ? `${pct}%` : s.phase === "ready" ? S.update.badgeReady : S.update.badge;
  const icon = s.phase === "downloading" ? "↓" : s.phase === "ready" ? "⟲" : "↑";

  return (
    <>
      <span
        className={`upd-badge${s.phase === "error" ? " bad" : ""}`}
        title={S.update.badgeTitle}
        onClick={() => s.setPopoverOpen(!s.popoverOpen)}
      >
        <span className="upd-ic">{icon}</span>
        {label}
      </span>
      {s.popoverOpen && (
        <>
          <div className="fpop-scrim" onMouseDown={() => s.setPopoverOpen(false)} />
          <div className="ctxmenu upd-pop">
            {s.phase === "checking" && <div className="upd-line">{S.update.checking}</div>}
            {s.phase === "idle" && <div className="upd-line">{S.update.upToDate}</div>}
            {s.phase === "error" && (
              <>
                <div className="upd-line">{S.update.failed}</div>
                <div className="upd-sub">{s.error}</div>
                <div className="mi" onClick={() => void s.check(true)}>
                  <span className="ic">⟳</span>
                  {S.update.retry}
                </div>
              </>
            )}
            {s.phase === "available" && s.version && (
              <>
                <div className="upd-line">{S.update.available(s.version)}</div>
                {s.notes && (
                  <>
                    <div className="upd-sub">{S.update.notesHead}</div>
                    <div className="upd-notes">{s.notes}</div>
                  </>
                )}
                <div className="mi" onClick={() => void s.install()}>
                  <span className="ic">⤓</span>
                  {S.update.installNow}
                </div>
                <div className="mi" onClick={() => s.setPopoverOpen(false)}>
                  <span className="ic">⏱</span>
                  {S.update.later}
                </div>
              </>
            )}
            {s.phase === "downloading" && (
              <>
                <div className="upd-line upd-row">
                  <span>{S.update.downloading}</span>
                  {known && <span className="upd-pct">{pct}%</span>}
                </div>
                {/* 길이를 모르면 막대가 0%에 멎은 것처럼 보인다. 그럴 땐 받은 용량만 보여준다. */}
                {known && (
                  <span className="progress">
                    <i style={{ width: `${pct}%` }} />
                  </span>
                )}
                <div className="upd-sub">
                  {known ? `${fmtBytes(s.downloaded)} / ${fmtBytes(s.total)}` : fmtBytes(s.downloaded)}
                </div>
              </>
            )}
            {s.phase === "ready" && (
              <>
                <div className="upd-line">{S.update.ready}</div>
                <div className="mi" onClick={() => void s.restart()}>
                  <span className="ic">⟲</span>
                  {S.update.restart}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
