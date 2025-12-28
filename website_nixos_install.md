---
title: Install on NixOS
description: How to install Kortex on NixOS and other Linux distributions using Nix.
---

# Install on NixOS

Kortex provides a [Nix Flake](https://nixos.wiki/wiki/Flakes) for easy, reproducible installation on NixOS. This is the recommended way to install Kortex on NixOS to ensure all dependencies (like Python, WebKitGTK, and audio libraries) are correctly linked.

## Option 1: Run Without Installing

You can run Kortex directly from the repository without installing it permanently:

```bash
nix run github:daschinmoy21/Kortex
```

## Option 2: Install to User Profile

To install Kortex into your user profile (available in your PATH):

```bash
nix profile install github:daschinmoy21/Kortex
```

## Option 3: Declarative NixOS Configuration

The best way to manage Kortex is to add it to your `flake.nix` configuration.

1. **Add the Input**: Add `kortex` to your `flake.nix` inputs:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    
    # Add Kortex input
    kortex = {
      url = "github:daschinmoy21/Kortex";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
  
  outputs = { self, nixpkgs, kortex, ... }: {
    # ...
  };
}
```

2. **Add to System Packages**: Pass `kortex` special arguments and add it to `environment.systemPackages` in your configuration module:

```nix
# In flake.nix (pass kortex to modules)
nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
  specialArgs = { inherit kortex; };
  modules = [ ./configuration.nix ];
};

# In configuration.nix
{ config, pkgs, kortex, ... }:

{
  environment.systemPackages = [
    # Install the default package from the flake
    kortex.packages.${pkgs.system}.default
  ];
}
```

3. **Rebuild**:
```bash
sudo nixos-rebuild switch --flake .
```

## Troubleshooting

### "Frontend dist not found"
If you are building from source using `nix build` locally, make sure you have generated the frontend assets first. Run `bun run build` in the root directory before running nix commands, or check out a commit where `dist/` is present.

### Audio/Transcription Issues
The Nix package automatically wraps the binary with the required `ffmpeg` and Python environment paths. If you experience issues with transcription, ensure you haven't overriden the `KORTEX_PYTHON_PATH` environment variable manually.
