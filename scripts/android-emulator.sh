#!/usr/bin/env bash
# Create (once) and boot a headless x86_64 Android emulator for Logia.
# Run inside the Android dev shell:  nix develop .#android -c scripts/android-emulator.sh
#
# Env overrides: AVD_NAME, AVD_API (35), AVD_DEVICE (pixel_7), AVD_MEMORY (2048 MB),
# AVD_WINDOW=1 to show the emulator window instead of running headless.
set -euo pipefail

AVD_NAME="${AVD_NAME:-logia_pixel}"
AVD_API="${AVD_API:-35}"
AVD_DEVICE="${AVD_DEVICE:-pixel_7}"
AVD_MEMORY="${AVD_MEMORY:-2048}"
IMAGE="system-images;android-${AVD_API};google_apis;x86_64"

if [[ -z "${ANDROID_HOME:-}" ]]; then
  echo "ANDROID_HOME is not set; enter the shell first: nix develop .#android" >&2
  exit 1
fi

if ! emulator -list-avds | grep -qx "$AVD_NAME"; then
  echo "Creating AVD $AVD_NAME ($IMAGE, $AVD_DEVICE)"
  echo no | avdmanager create avd --force --name "$AVD_NAME" --package "$IMAGE" --device "$AVD_DEVICE"
  # Keep RAM modest and enable the hardware keyboard so `adb shell input` and
  # a desktop keyboard both work.
  cfg="${ANDROID_AVD_HOME:-$HOME/.android/avd}/$AVD_NAME.avd/config.ini"
  sed -i '/^hw.ramSize=/d; /^hw.keyboard=/d' "$cfg"
  printf 'hw.ramSize=%s\nhw.keyboard=yes\n' "$AVD_MEMORY" >> "$cfg"
fi

if adb devices | grep -q '^emulator-'; then
  echo "An emulator is already running:"
  adb devices
  exit 0
fi

window_flags=(-no-window)
[[ "${AVD_WINDOW:-0}" == 1 ]] && window_flags=()

echo "Booting $AVD_NAME (log: ${TMPDIR:-/tmp}/logia-emulator.log)"
nohup emulator -avd "$AVD_NAME" "${window_flags[@]}" -no-audio -no-boot-anim \
  -gpu swiftshader_indirect -no-snapshot -memory "$AVD_MEMORY" \
  >"${TMPDIR:-/tmp}/logia-emulator.log" 2>&1 &
echo "emulator pid $!"

adb wait-for-device
until [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; do
  sleep 2
done
echo "Booted:"
adb devices
