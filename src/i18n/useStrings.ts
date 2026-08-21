import { useStore } from "../store";
import { DICTS, Strings } from "./index";

// React hook: returns the active locale's strings and re-renders the component
// when the language changes. Kept separate from ./index so ./index has no
// dependency on the store (store depends on ./index for `strings()`).
export function useStrings(): Strings {
  const lang = useStore((s) => s.lang);
  return DICTS[lang];
}
