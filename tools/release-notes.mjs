import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function validateReleaseNotes(value) {
  for (const lang of ["en", "ko"]) {
    if (typeof value?.[lang] !== "string" || !value[lang].trim()) {
      throw new Error(`Release notes require a non-empty ${lang} translation.`);
    }
  }
  return { en: value.en, ko: value.ko };
}

export function loadReleaseNotes(version) {
  const normalized = version.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) throw new Error(`Invalid release version: ${version}`);
  return validateReleaseNotes(JSON.parse(readFileSync(join(ROOT, "releases", `${normalized}.json`), "utf8")));
}

export function applyReleaseNotes(manifest, notes, version) {
  if (manifest.version?.replace(/^v/, "") !== version.replace(/^v/, "")) {
    throw new Error("Updater manifest version does not match the release tag.");
  }
  const localized = validateReleaseNotes(notes);
  // 기존 앱은 notes만 읽으므로 기본 영문 노트를 유지한다.
  return { ...manifest, notes: localized.en, notes_i18n: localized };
}

function main() {
  const [command, version, manifestPath, bodyPath] = process.argv.slice(2);
  if (!version || !["validate", "apply"].includes(command) || (command === "apply" && (!manifestPath || !bodyPath))) {
    throw new Error("Usage: node tools/release-notes.mjs validate <version> | apply <version> <manifest> <body>");
  }
  const notes = loadReleaseNotes(version);
  if (command === "apply") {
    const manifest = applyReleaseNotes(JSON.parse(readFileSync(manifestPath, "utf8")), notes, version);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    writeFileSync(bodyPath, `## English\n\n${notes.en}\n\n## 한국어\n\n${notes.ko}\n`);
  }
  console.log(`Release notes validated: ${version} (en, ko)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
