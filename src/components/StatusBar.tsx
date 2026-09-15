import { focusedBus } from "../controller";
import { useStrings } from "../i18n/useStrings";
import { fmtBytes, fmtInt } from "../format";
import { useStore } from "../store";
import { FilterChips } from "./ChipBar";

export function StatusBar() {
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeId) ?? null);
  const focusedView = useStore((s) => s.focusedView);
  const viewState = useStore((s) => (s.focusedView ? (s.viewStates[s.focusedView] ?? null) : null));
  const patchTab = useStore((s) => s.patchTab);
  const patchView = useStore((s) => s.patchView);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  const S = useStrings();

  // 탭이 없어도 막대는 그린다. 테마·언어 전환이 여기 있어서, 파일을 열기 전
  // 화면에서 막대가 사라지면 그 둘을 아예 누를 수 없다.
  const pct = tab && tab.fileSize > 0 ? Math.min(100, Math.round((tab.indexedBytes / tab.fileSize) * 100)) : 0;

  return (
    <div className="status">
      {tab ? (
        <>
          <span className={`live${viewState?.follow ? "" : " paused"}`}>
            <i />
            {viewState?.follow ? "LIVE" : "PAUSED"}
          </span>
          <span className="mono">
            {fmtInt(tab.totalLines)} lines · {fmtBytes(tab.fileSize)}
          </span>
          <span className="mono" style={{ color: "var(--t3)" }}>
            UTF-8 · {tab.isJson ? "JSON Lines" : S.statusbar.text} ({S.statusbar.autoDetected})
          </span>
          {tab.indexing && (
            <>
              <span className="progress">
                <i style={{ width: `${pct}%` }} />
              </span>
              <span className="mono" style={{ color: "var(--t3)" }}>
                {S.statusbar.indexing(pct)}
              </span>
            </>
          )}
          {!tab.search.done && (
            <span className="mono" style={{ color: "var(--t3)" }}>
              {S.statusbar.searching(tab.search.of > 0 ? Math.round((tab.search.scanned / tab.search.of) * 100) : 0)}
            </span>
          )}
        </>
      ) : (
        <span className="mono" style={{ color: "var(--t3)" }}>
          {S.statusbar.noFile}
        </span>
      )}
      <FilterChips />
      <div className="right">
        {tab && (
          <span
            className={`sbtn${tab.wrap ? " on" : ""}`}
            title={S.statusbar.wrapTitle}
            onClick={() => patchTab(tab.id, { wrap: !tab.wrap })}
          >
            ↩
          </span>
        )}
        <span className="sbtn" title={S.statusbar.paletteTitle} onClick={() => useStore.getState().setPaletteOpen(true)}>
          🔍
        </span>
        <span className="sbtn" title={S.statusbar.shortcutsTitle} onClick={() => useStore.getState().setShortcutsOpen(true)}>
          ?
        </span>
        <span className="sbtn" title={S.statusbar.langTitle} onClick={() => setLang(lang === "en" ? "ko" : "en")}>
          {lang === "en" ? "EN" : "한"}
        </span>
        <span className="sbtn" title={S.statusbar.themeTitle} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "☾" : "☀"}
        </span>
        {viewState && (
          <div
            className={`follow${viewState.follow ? "" : " off"}`}
            title={S.statusbar.followTitle}
            onClick={() => {
              if (!focusedView) return;
              const next = !viewState.follow;
              patchView(focusedView, { follow: next, pendingNew: 0 });
              if (next) focusedBus()?.toBottom();
            }}
          >
            {viewState.follow ? "⬇ FOLLOW" : "⏸ PAUSED"}
          </div>
        )}
      </div>
    </div>
  );
}
