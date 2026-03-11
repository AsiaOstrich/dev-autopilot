import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  // Bundle all workspace dependencies into a single file
  noExternal: [
    "@devap/core",
    "@devap/adapter-claude",
    "@devap/adapter-opencode",
    "@devap/adapter-cli",
  ],
});
