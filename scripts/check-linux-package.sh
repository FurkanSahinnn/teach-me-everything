#!/usr/bin/env bash
set -euo pipefail

shopt -s nullglob
images=(src-tauri/target/release/bundle/appimage/*.AppImage)
if [[ ${#images[@]} != 1 ]]; then
  echo "Expected one Linux AppImage, found ${#images[@]}" >&2
  exit 1
fi

image="$(realpath "${images[0]}")"
workdir="$(mktemp -d)"
trap 'rm -rf -- "$workdir"' EXIT
cd "$workdir"

# The CI runner can inspect and run the image without mounting it with FUSE.
"$image" --appimage-extract > /dev/null
piper="$(find squashfs-root -path "*/piper-$(uname -m)-unknown-linux-gnu/piper" -type f -print -quit)"
test -x "$piper"
test -d "$(dirname "$piper")/espeak-ng-data"
"$piper" --help > piper.log 2>&1 || { cat piper.log; exit 1; }

dbus-run-session -- xvfb-run -a bash -euo pipefail -c '
  ./squashfs-root/AppRun > app.log 2>&1 &
  app_pid=$!
  trap "kill $app_pid 2>/dev/null || true" EXIT
  if ! timeout 60s xdotool search --sync --onlyvisible --name "Teach Me Everything"; then
    cat app.log
    exit 1
  fi
  kill -0 "$app_pid"
'
