{
  description = "aimcurve dev shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          # pnpm comes from corepack, pinned by package.json's `packageManager`.
          packages = with pkgs; [
            nodejs_22
            corepack
          ];

          shellHook = ''
            echo "node $(node -v) / pnpm $(pnpm -v)"
          '';
        };
      }
    );
}
