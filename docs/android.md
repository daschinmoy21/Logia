# Android

Logia builds as a Tauri 2 Android app. Everything (SDK, NDK, emulator, JDK 17,
a Rust toolchain with the Android targets) comes from the flake's
`android` dev shell; nothing is installed globally.

## Enter the shell

```fish
nix develop .#android
```

The shell exports `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `NDK_HOME`, `JAVA_HOME`
and puts `adb`, `emulator`, `avdmanager` and `sdkmanager` on `PATH`. The SDK
lives in the Nix store (read-only), so `sdkmanager --install` won't work: add
packages in `flake.nix` (`androidComposition`) instead.

The first entry downloads several GB (NDK, system image, platforms).

## Build an APK

```fish
bun install            # once, if node_modules is missing
bun run android:build  # debug APK for the x86_64 emulator
```

The APK lands in
`src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.
For a phone (arm64), build `bun run android:build:arm64` instead.
The debug APK is about 210 MB, almost all of it Rust debug symbols.

Android builds put the frontend in `dist-mobile/` (ignored by git), set in
`src-tauri/tauri.android.conf.json`, so the tracked `dist/` used by the Nix
desktop package is left alone. That file also drops the desktop bundle
resources (the Python transcription script and `logia-cli.mjs`) from the APK.

## Run on the emulator

```fish
bun run android:emulator   # creates the "logia_pixel" AVD once, boots it headless
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb shell monkey -p com.logia.app 1
```

`set -x AVD_WINDOW 1; bun run android:emulator` shows the emulator window.
Stop it with `adb emu kill`.

`bun run android:dev` should run the Vite dev server with hot reload on the
running emulator or a connected phone (not yet tried).

Logs: `adb logcat | grep -iE 'logia|RustStdoutStderr|chromium'`.

## Install on a phone

1. On the phone, enable Developer options and USB debugging.
2. Plug it in and accept the prompt; `adb devices` should list it.
3. Build for arm64 and install:

```fish
bun run android:build:arm64
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

Debug APKs are signed with the debug key in `~/.android/debug.keystore`.
A release build needs its own signing config (not set up yet).

## What differs from desktop

Notes, folders, tasks and trash are stored in the app's private data dir
(`/data/user/0/com.logia.app/Logia/`, i.e. `BaseDirectory::AppData`) instead of
`~/Documents/Logia`. They survive `adb install -r` but are removed when the app is uninstalled.
Inspect them with
`adb shell run-as com.logia.app ls -R /data/user/0/com.logia.app/Logia`.

API keys are kept only in the encrypted `config.json` in the app config dir;
there is no keyring on Android.

These commands are registered but return `"not available on mobile"`:
git sync and the source control panel, agent CLIs (`ai_cli_*`) and agent
terminals, the `logia-cli` bridge, audio recording and transcription.
`ai_cli_detect` returns an empty list. The updater and process plugins are
desktop-only.
