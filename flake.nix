{
  description = "Logia - A modern AI-powered workspace";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      # Apply overlay to fix ctranslate2 build (missing cstdint header)
      pkgs = import nixpkgs {
        inherit system;
        overlays = [
          (final: prev: {
            ctranslate2 = prev.ctranslate2.overrideAttrs (oldAttrs: {
              env =
                (oldAttrs.env or {})
                // {
                  CXXFLAGS = (oldAttrs.env.CXXFLAGS or "") + " -include cstdint";
                };
            });
          })
        ];
      };

      # Python environment with faster-whisper for transcription
      pythonEnv = pkgs.python312.withPackages (ps:
        with ps; [
          faster-whisper
        ]);

      # Runtime libraries needed by WebKitGTK and Tauri
      runtimeLibs = pkgs.lib.optionals pkgs.stdenv.isLinux (with pkgs; [
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
      ]);

      # Build-time dependencies
      nativeBuildDeps =
        (with pkgs; [pkg-config ffmpeg cargo-tauri])
        ++ pkgs.lib.optionals pkgs.stdenv.isLinux (with pkgs; [
          gobject-introspection
          wrapGAppsHook3
          pulseaudio
        ]);

      frontendTools = with pkgs; [bun nodejs_24 git liveCli];

      agentCli = pkgs.writeShellApplication {
        name = "logia-agent";
        runtimeInputs = [pkgs.nodejs_24];
        text = ''
          exec node --experimental-strip-types "${self}/scripts/logia-agent.ts" "$@"
        '';
      };

      liveCli = pkgs.writeShellApplication {
        name = "logia-cli";
        runtimeInputs = [pkgs.nodejs_24];
        text = ''
          exec node "${self}/scripts/logia-cli.mjs" "$@"
        '';
      };

      mkDevShell = withAudio:
        pkgs.mkShell {
          nativeBuildInputs =
            frontendTools
            ++ nativeBuildDeps
            ++ (with pkgs; [
              cargo
              rustc
              rustfmt
              clippy
              uv
              python312
            ])
            ++ pkgs.lib.optionals pkgs.stdenv.isLinux [pkgs.xdg-utils]
            ++ pkgs.lib.optional withAudio pythonEnv;
          buildInputs = runtimeLibs ++ [pkgs.openssl];
          OPENSSL_NO_VENDOR = 1;
          CARGO_BUILD_JOBS = "2";
          shellHook =
            pkgs.lib.optionalString pkgs.stdenv.isLinux ''
              export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:''${XDG_DATA_DIRS:-}"
              export GIO_MODULE_DIR="${pkgs.glib-networking}/lib/gio/modules/"
            ''
            + pkgs.lib.optionalString withAudio ''
              export LOGIA_PYTHON_PATH="${pythonEnv}/bin/python"
            '';
        };
    in {
      packages =
        {
          agent = agentCli;
          cli = liveCli;
        }
        // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
          logia = pkgs.rustPlatform.buildRustPackage rec {
            pname = "logia";
            version = "0.12.0";

            src = ./.;

            # Point to the Cargo workspace in src-tauri
            cargoRoot = "src-tauri";
            buildAndTestSubdir = "src-tauri";

            cargoLock = {
              lockFile = ./src-tauri/Cargo.lock;
            };

            nativeBuildInputs = nativeBuildDeps ++ [pkgs.pkg-config];
            buildInputs = runtimeLibs ++ [pythonEnv pkgs.openssl];
            nativeCheckInputs = [pkgs.nodejs_24];

            # Environment variables for the build
            OPENSSL_NO_VENDOR = 1;

            # Avoid relying on /bin/sh in the sandbox for PTY test commands
            # and the model-discovery test's generated shell script.
            postPatch = ''
              substituteInPlace src-tauri/src/terminal_process.rs \
                --replace-fail '"/bin/sh"' '"${pkgs.runtimeShell}"'
              substituteInPlace src-tauri/src/cli_models.rs \
                --replace-fail '#!/bin/sh' '#!${pkgs.runtimeShell}'
            '';

            # Override the default build phase to use cargo-tauri properly
            buildPhase = ''
              runHook preBuild

              echo "Frontend dist contents:"
              ls -la dist/

              cd src-tauri

              # Create a config override file to skip beforeBuildCommand
              cat > tauri.nix.conf.toml << 'EOF'
              [build]
              beforeBuildCommand = ""
              beforeDevCommand = ""
              EOF

              # Use cargo-tauri build with config override file
              cargo tauri build --no-bundle --ci --config tauri.nix.conf.toml

              cd ..

              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall

              mkdir -p $out/bin
              cp src-tauri/target/release/logia $out/bin/

              # Install transcription resources
              mkdir -p $out/share/logia/transcription
              cp src-tauri/src/audio/transcription/transcribe.py $out/share/logia/transcription/
              cp src-tauri/src/audio/transcription/requirements.txt $out/share/logia/transcription/

              # Install desktop file
              mkdir -p $out/share/applications
              cat > $out/share/applications/logia.desktop << EOF
              [Desktop Entry]
              Name=Logia
              Comment=A modern AI-powered workspace
              Exec=$out/bin/logia
              Icon=logia
              Terminal=false
              Type=Application
              Categories=Office;Productivity;
              EOF

              # Install icons if they exist
              if [ -d "src-tauri/icons" ]; then
                mkdir -p $out/share/icons/hicolor/128x128/apps
                cp src-tauri/icons/128x128.png $out/share/icons/hicolor/128x128/apps/logia.png 2>/dev/null || true
              fi

              runHook postInstall
            '';

            postFixup = ''
              wrapProgram $out/bin/logia \
                --set LOGIA_PYTHON_PATH "${pythonEnv}/bin/python" \
                --set LOGIA_TRANSCRIBE_SCRIPT "$out/share/logia/transcription/transcribe.py" \
                --prefix PATH : "${pkgs.lib.makeBinPath [pkgs.ffmpeg pkgs.pulseaudio pkgs.uv pkgs.git pkgs.openssh liveCli pkgs.nodejs_24]}" \
                --prefix XDG_DATA_DIRS : "${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}" \
                --prefix XDG_DATA_DIRS : "${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}" \
                --set GIO_MODULE_DIR "${pkgs.glib-networking}/lib/gio/modules/"
            '';

            meta = with pkgs.lib; {
              description = "A modern AI-powered workspace";
              homepage = "https://github.com/daschinmoy21/Logia";
              license = licenses.agpl3Only;
              maintainers = [];
              platforms = platforms.linux;
              mainProgram = "logia";
            };
          };

          default = self.packages.${system}.logia;
        };

      formatter = pkgs.alejandra;

      checks.workspace =
        pkgs.runCommand "logia-workspace-contract" {
          nativeBuildInputs = [pkgs.nodejs_24];
        } ''
          node --experimental-strip-types --test \
            "${self}/src/lib/workspace.test.ts" \
            "${self}/src/lib/composer-vim.test.ts" \
            "${self}/src/lib/terminal-links.test.ts" \
            "${self}/scripts/logia-agent.test.ts" \
            "${self}/scripts/logia-cli.test.ts"
          touch "$out"
        '';

      devShells =
        {
          # UI and agent tools need no GTK, Rust, or transcription model runtime.
          frontend = pkgs.mkShell {packages = frontendTools;};
          default = mkDevShell false;
        }
        // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
          audio = mkDevShell true;
          browser = pkgs.mkShell {
            packages = frontendTools ++ [pkgs.chromium];
            PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";
          };
        };

      apps =
        {
          cli = (flake-utils.lib.mkApp {drv = liveCli;}) // {meta.description = "Control the running Logia GUI from an agent or terminal";};
          agent =
            (flake-utils.lib.mkApp {drv = agentCli;})
            // {
              meta.description = "Read, search, and export a Logia workspace";
            };
        }
        // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
          default =
            (flake-utils.lib.mkApp {
              drv = self.packages.${system}.default;
            })
            // {meta.description = "Logia desktop workspace";};
        };
    });
}
