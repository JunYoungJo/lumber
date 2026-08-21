import { useRef, useState } from "react";
import { jumpKind } from "../controller";
import { fmtInt } from "../format";
import { hasFilter, useStore } from "../store";

interface FilterEntry {
  icon: string;
  label: string;
  clear: () => void;
}

export function FilterChips() {
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeId) ?? null);
  const patchTab = useStore((s) => s.patchTab);
  const applyFilter = useStore((s) => s.applyFilter);
  const runSearch = useStore((s) => s.runSearch);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);

  if (!tab) return null;
  const tabId = tab.id;

  function patchAndApply(patch: Parameters<typeof patchTab>[1]) {
    patchTab(tabId, patch);
    queueMicrotask(() => applyFilter(tabId));
  }

  const entries: FilterEntry[] = [];
  tab.includes.forEach((term, i) => {
    entries.push({
      icon: "◧",
      label: `포함: ${term}`,
      clear: () => patchAndApply({ includes: tab.includes.filter((_, x) => x !== i) }),
    });
  });
  tab.excludes.forEach((term, i) => {
    entries.push({
      icon: "⊘",
      label: `제외: ${term}`,
      clear: () => patchAndApply({ excludes: tab.excludes.filter((_, x) => x !== i) }),
    });
  });
  tab.fields.forEach((f, i) => {
    entries.push({
      icon: "⦿",
      label: `${f.key}: ${f.value}`,
      clear: () => patchAndApply({ fields: tab.fields.filter((_, x) => x !== i) }),
    });
  });
  if (tab.levelsOff.length > 0) {
    entries.push({
      icon: "◫",
      label: `${tab.levelsOff.length}개 레벨 숨김`,
      clear: () => patchAndApply({ levelsOff: [] }),
    });
  }

  const showPopover = open && entries.length > 0;
  const rect = anchorRef.current?.getBoundingClientRect();
  const popLeft = rect ? Math.min(rect.left, window.innerWidth - 460) : 200;

  return (
    <div className="sbchips">
      {hasFilter(tab) && (
        <span className="mono" style={{ color: "var(--acc)", flexShrink: 0 }}>
          {fmtInt(tab.viewLen)} / {fmtInt(tab.totalLines)} 표시
          {!tab.viewComplete && " · 필터링 중…"}
        </span>
      )}
      {tab.search.spec && (
        <span className="chip" title={`검색: ${tab.search.spec.pattern}`}>
          <span className="clip">🔍 {tab.search.spec.pattern}</span>
          {tab.search.done ? (
            <b style={{ flexShrink: 0 }}>
              {tab.search.cursor !== null ? `${fmtInt(tab.search.cursor + 1)}/${fmtInt(tab.search.total)}` : `${fmtInt(tab.search.total)}건`}
            </b>
          ) : (
            <span className="searching">{fmtInt(tab.search.total)}…</span>
          )}
          <span className="nav" title="이전 매치 (Ctrl+↑)" onClick={() => void jumpKind("match", -1)}>
            ▲
          </span>
          <span className="nav" title="다음 매치 (Ctrl+↓)" onClick={() => void jumpKind("match", 1)}>
            ▼
          </span>
          <span className="x" onClick={() => runSearch(tabId, null)}>
            ✕
          </span>
        </span>
      )}
      {entries.length > 0 && (
        <span
          className={`chip clickable${open ? " open" : ""}`}
          ref={anchorRef}
          title="클릭하여 필터 목록 열기"
          onClick={() => setOpen(!open)}
        >
          <span className="clip">◧ 필터 {entries.length}</span>
          <span className="caret">{open ? "▾" : "▴"}</span>
        </span>
      )}
      {showPopover && (
        <>
          <div className="fpop-scrim" onClick={() => setOpen(false)} />
          <div className="fpop" style={{ left: popLeft }}>
            <div className="fpop-head">활성 필터</div>
            {entries.map((e, i) => (
              <div className="fpop-row" key={i}>
                <span className="ic">{e.icon}</span>
                <span className="ftext">{e.label}</span>
                <span className="x" title="이 필터 제거" onClick={e.clear}>
                  ✕
                </span>
              </div>
            ))}
            <div
              className="fpop-foot"
              onClick={() => {
                patchAndApply({ levelsOff: [], includes: [], excludes: [], includeDraft: "", fields: [] });
                setOpen(false);
              }}
            >
              ⟲ 모두 지우기
            </div>
          </div>
        </>
      )}
    </div>
  );
}
