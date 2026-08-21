import { useStrings } from "../i18n/useStrings";
import { useStore } from "../store";

export function Shortcuts() {
  const open = useStore((s) => s.shortcutsOpen);
  const setOpen = useStore((s) => s.setShortcutsOpen);
  const S = useStrings();
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="shortcuts">
        <div className="sc-head">
          <h3>{S.shortcuts.title}</h3>
          <span className="x" onClick={() => setOpen(false)}>
            ✕
          </span>
        </div>
        <div className="sc-body">
          {S.shortcuts.groups.map((g) => (
            <div key={g.title} className="sc-group">
              <h6>{g.title}</h6>
              {g.items.map(([key, desc]) => (
                <div key={key} className="sc-row">
                  <span>{desc}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
