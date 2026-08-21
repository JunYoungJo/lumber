import { useRef, useState } from "react";
import { jumpKind } from "../controller";
import { useStrings } from "../i18n/useStrings";
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
  const S = useStrings();

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
      label: S.chip.include(term),
      clear: () => patchAndApply({ includes: tab.includes.filter((_, x) => x !== i) }),
    });
  });
  tab.excludes.forEach((term, i) => {
    entries.push({
      icon: "⊘",
      label: S.chip.exclude(term),
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
      label: S.chip.levelsHidden(tab.levelsOff.length),
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
          {S.chip.shown(fmtInt(tab.viewLen), fmtInt(tab.totalLines))}
          {!tab.viewComplete && S.chip.filtering}
        </span>
      )}
      {tab.search.spec && (
        <span className="chip" title={S.chip.searchTitle(tab.search.spec.pattern)}>
          <span className="clip">🔍 {tab.search.spec.pattern}</span>
          {tab.search.done ? (
            <b style={{ flexShrink: 0 }}>
              {tab.search.cursor !== null ? `${fmtInt(tab.search.cursor + 1)}/${fmtInt(tab.search.total)}` : S.chip.hits(fmtInt(tab.search.total))}
            </b>
          ) : (
            <span className="searching">{fmtInt(tab.search.total)}…</span>
          )}
          <span className="nav" title={S.chip.prevMatch} onClick={() => void jumpKind("match", -1)}>
            ▲
          </span>
          <span className="nav" title={S.chip.nextMatch} onClick={() => void jumpKind("match", 1)}>
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
          title={S.chip.openFilterList}
          onClick={() => setOpen(!open)}
        >
          <span className="clip">{S.chip.filters(entries.length)}</span>
          <span className="caret">{open ? "▾" : "▴"}</span>
        </span>
      )}
      {showPopover && (
        <>
          <div className="fpop-scrim" onClick={() => setOpen(false)} />
          <div className="fpop" style={{ left: popLeft }}>
            <div className="fpop-head">{S.chip.activeFilters}</div>
            {entries.map((e, i) => (
              <div className="fpop-row" key={i}>
                <span className="ic">{e.icon}</span>
                <span className="ftext">{e.label}</span>
                <span className="x" title={S.chip.removeFilter} onClick={e.clear}>
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
              {S.chip.clearAll}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
