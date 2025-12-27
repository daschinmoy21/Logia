{
  description = "Kortex - A modern AI-powered workspace";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        # Python environment with faster-whisper for transcription
        pythonEnv = pkgs.python3.withPackages (ps: with ps; [
          faster-whisper
        ]);

        # Runtime libraries needed by WebKitGTK and Tauri
        runtimeLibs = with pkgs; [
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
          webkitgtk_4_1
          openssl
          glib-networking
          gsettings-desktop-schemas
        ];

        # Build-time dependencies
        nativeBuildDeps = with pkgs; [
          pkg-config
          gobject-introspection
          cargo
          rustc
          cargo-tauri
          bun
          wrapGAppsHook4
          ffmpeg
          pulseaudio
          openssl
        ];

      in {
        packages = {
          default = pkgs.stdenv.mkDerivation rec {
            pname = "kortex";
            version = "0.8.11";

            src = ./.;

            nativeBuildInputs = nativeBuildDeps;
            buildInputs = runtimeLibs ++ [ pythonEnv ];

            # Required for cargo to fetch dependencies
            CARGO_HOME = "$TMPDIR/cargo";
            
            # OpenSSL configuration
            OPENSSL_NO_VENDOR = 1;
            PKG_CONFIG_PATH = "${pkgs.openssl.dev}/lib/pkgconfig";

            configurePhase = ''
              runHook preConfigure
              
              # Set up cargo home
              export CARGO_HOME="$TMPDIR/cargo"
              mkdir -p $CARGO_HOME
              
              runHook postConfigure
            '';

            buildPhase = ''
              runHook preBuild
              
              echo "Installing frontend dependencies..."
              bun install --frozen-lockfile
              
              echo "Building frontend..."
              bun run build
              
              echo "Building Tauri application..."
              cd src-tauri
              cargo tauri build --bundles none
              cd ..
              
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              
              # Install the binary
              mkdir -p $out/bin
              cp src-tauri/target/release/kortex $out/bin/
              
              # Install transcription resources
              mkdir -p $out/share/kortex/transcription
              cp src-tauri/src/audio/transcription/transcribe.py $out/share/kortex/transcription/
              cp src-tauri/src/audio/transcription/requirements.txt $out/share/kortex/transcription/
              
              # Install desktop file
              mkdir -p $out/share/applications
              cat > $out/share/applications/kortex.desktop << EOF
              [Desktop Entry]
              Name=Kortex
              Comment=A modern AI-powered workspace
              Exec=$out/bin/kortex
              Icon=kortex
              Terminal=false
              Type=Application
              Categories=Office;Productivity;
              EOF
              
              # Install icons if they exist
              if [ -d "src-tauri/icons" ]; then
                mkdir -p $out/share/icons/hicolor/128x128/apps
                cp src-tauri/icons/128x128.png $out/share/icons/hicolor/128x128/apps/kortex.png 2>/dev/null || true
              fi
              
              runHook postInstall
            '';

            # Wrap the binary with necessary environment variables
            postFixup = ''
              wrapProgram $out/bin/kortex \
                --set KORTEX_PYTHON_PATH "${pythonEnv}/bin/python" \
                --set KORTEX_TRANSCRIBE_SCRIPT "$out/share/kortex/transcription/transcribe.py" \
                --prefix PATH : "${pkgs.lib.makeBinPath [ pkgs.ffmpeg pkgs.pulseaudio ]}" \
                --prefix XDG_DATA_DIRS : "${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}" \
                --prefix XDG_DATA_DIRS : "${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}" \
                --set GIO_MODULE_DIR "${pkgs.glib-networking}/lib/gio/modules/"
            '';

            meta = with pkgs.lib; {
              description = "A modern AI-powered workspace";
              homepage = "https://github.com/daschinmoy21/Kortex";
              license = licenses.mit; # Change this to your actual license
              maintainers = [];
              platforms = platforms.linux;
              mainProgram = "kortex";
            };
          };
        };

        # Development shell (replaces your shell.nix)
        devShells.default = pkgs.mkShell {
          nativeBuildInputs = nativeBuildDeps ++ [ 
            pythonEnv 
            pkgs.uv
            pkgs.xdg-utils
          ];
          
          buildInputs = runtimeLibs ++ [
            pkgs.cargo-tauri.hook
          ];

          OPENSSL_NO_VENDOR = 1;
          PKG_CONFIG_PATH = "${pkgs.openssl.dev}/lib/pkgconfig";

          shellHook = ''
            # Points Tauri/WebKit to the portal and schema settings
            export XDG_DATA_DIRS=${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS

            # Explicit python path for NixOS (uses the wrapped python with packages)
            export KORTEX_PYTHON_PATH="$(which python)"

            # Fixes "Could not find document directory" by helping GIO find modules
            export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules/"

            export XDG_RUNTIME_DIR=''${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
            export DBUS_SESSION_BUS_ADDRESS=''${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}
            
            echo "🚀 Kortex development shell loaded!"
            echo "   Run 'bun tauri dev' to start development"
            echo "   Run 'bun tauri build' to build for release"
          '';
        };

        # Convenient app output for `nix run`
        apps.default = flake-utils.lib.mkApp {
          drv = self.packages.${system}.default;
        };
      });
}
