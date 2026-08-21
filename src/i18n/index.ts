import { en, Strings } from "./en";
import { ko } from "./ko";

export type Lang = "en" | "ko";
export type { Strings };

export const DICTS: Record<Lang, Strings> = { en, ko };
export const LANGS: Lang[] = ["en", "ko"];

// Current locale for non-React callers (store actions, event handlers). The
// store keeps `lang` as the source of truth and calls `setLangDict` whenever
// it changes; React components use `useStrings` instead so they re-render.
let current: Lang = "en";

export function setLangDict(lang: Lang): void {
  current = lang;
}

export function strings(): Strings {
  return DICTS[current];
}
