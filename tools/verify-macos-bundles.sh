#!/bin/bash
# 배포되는 세 가지 형태(.app, 업데이터용 .app.tar.gz, .dmg) 안의 앱 번들이 코드 서명
# 검증을 통과하는지 확인한다. 번들 전체가 서명되지 않으면 Apple Silicon에서는 내려받은
# 앱이 "손상되었다"고 표시되며 열리지 않는다.
# 번들 무결성만 확인한다. Developer ID 신뢰나 공증 여부는 확인하지 않는다.
set -euo pipefail

bundle_dir="${1:?Usage: verify-macos-bundles.sh <bundle-directory>}"
app_name="Lumber.app"

verify_app() {
  codesign --verify --deep --strict --verbose=2 "$1"
}

verify_app "$bundle_dir/macos/$app_name"

archives=("$bundle_dir"/macos/*.app.tar.gz)
images=("$bundle_dir"/dmg/*.dmg)
if [[ ${#archives[@]} -ne 1 || ! -f "${archives[0]}" || ${#images[@]} -ne 1 || ! -f "${images[0]}" ]]; then
  echo 'Expected exactly one macOS updater archive and one DMG.' >&2
  exit 1
fi

temporary="$(mktemp -d)"
mounted=false
cleanup() {
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$temporary/dmg" || return 1
  fi
  rm -rf "$temporary"
}
trap cleanup EXIT

mkdir "$temporary/updater"
tar -xzf "${archives[0]}" -C "$temporary/updater"
verify_app "$temporary/updater/$app_name"

hdiutil attach -readonly -nobrowse -mountpoint "$temporary/dmg" "${images[0]}"
mounted=true
verify_app "$temporary/dmg/$app_name"
echo 'Verified the macOS app signature in the app, updater archive, and DMG.'
