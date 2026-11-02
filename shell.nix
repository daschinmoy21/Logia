# Use the same pinned dependencies as `nix develop` (requires flakes support).
(builtins.getFlake (toString ./.)).devShells.${builtins.currentSystem}.default
