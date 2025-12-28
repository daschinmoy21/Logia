# Run with `nix-shell shell.nix`
let
  pkgs = import <nixpkgs> {};
in
  pkgs.mkShell {
    nativeBuildInputs = with pkgs; [
      pkg-config
      gobject-introspection
      cargo
      xdg-utils
      cargo-tauri
      bun
      nodejs
      wrapGAppsHook4 # Fixes portal/settings access by wrapping the binary
      ffmpeg
      pulseaudio # Provides pactl
      (python3.withPackages (python-pkgs:
        with python-pkgs; [
          faster-whisper
        ]))
      uv
    ];

    buildInputs = with pkgs; [
      cargo-tauri.hook
      at-spi2-atk
      atkmm
      cairo
      gdk-pixbuf
      glib
      gtk3
      harfbuzz
      librsvg
      libsoup_3
      pango
      webkitgtk_4_1 # Essential for Tauri 2.0 webview
      openssl

      # Additional runtime dependencies for Webview/GIO
      glib-networking
      gsettings-desktop-schemas
    ];

    shellHook = ''
      # Points Tauri/WebKit to the portal and schema settings
      export XDG_DATA_DIRS=${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS

      # Explicit python path for NixOS (uses the wrapped python with packages)
      export KORTEX_PYTHON_PATH="$(which python)"

      # Fixes "Could not find document directory" by helping GIO find modules
      export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules/";

      # Optional: Workaround for rendering issues on some Wayland/NVIDIA setups
      # export WEBKIT_DISABLE_DMABUF_RENDERER=1

      export XDG_RUNTIME_DIR=/run/user/$(id -u)
      export DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus
      export XDG_CURRENT_DESKTOP=Hyprland
      export XDG_SESSION_TYPE=wayland
    '';
  }
