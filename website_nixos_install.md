
# Install on NixOS

Logia provides a [Nix Flake](https://nixos.wiki/wiki/Flakes) for easy, reproducible installation on NixOS. This is the recommended way to install Logia on NixOS to ensure all dependencies (like Python, WebKitGTK, and audio libraries) are correctly linked.

## Option 1: Run Without Installing

You can run Logia directly from the repository without installing it permanently:

```bash
nix run github:daschinmoy21/Logia
```

## Option 2: Install to User Profile

To install Logia into your user profile (available in your PATH):

```bash
nix profile install github:daschinmoy21/Logia
```

## Option 3: Declarative NixOS Configuration

The best way to manage Logia is to add it to your `flake.nix` configuration.

1. **Add the Input**: Add `logia` to your `flake.nix` inputs:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    
    # Add Logia input
    logia = {
      url = "github:daschinmoy21/Logia";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
  
  outputs = { self, nixpkgs, logia, ... }: {
    # ...
  };
}
```

2. **Add to System Packages**: Pass `logia` special arguments and add it to `environment.systemPackages` in your configuration module:

```nix
# In flake.nix (pass logia to modules)
nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
  specialArgs = { inherit logia; };
  modules = [ ./configuration.nix ];
};

# In configuration.nix
{ config, pkgs, logia, ... }:

{
  environment.systemPackages = [
    # Install the default package from the flake
    logia.packages.${pkgs.system}.default
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
The Nix package automatically wraps the binary with the required `ffmpeg` and Python environment paths. If you experience issues with transcription, ensure you haven't overriden the `LOGIA_PYTHON_PATH` environment variable manually.
