import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phase 5 Day 0: SDK is installed via `file:../../packages/sdk`, which npm 10+
  // symlinks into node_modules. Turbopack needs explicit transpile for symlinked
  // workspace-style deps, otherwise `import('@bountymesh/sdk')` fails at runtime
  // with "Cannot find module" in dev (browser bundle).
  transpilePackages: ["@bountymesh/sdk"],

  // Standalone build output for Railway Docker deploy — copies a self-contained
  // server.js + minimal node_modules into .next/standalone, avoiding the full
  // node_modules tree in the production image.
  output: "standalone",

  // Set the monorepo root explicitly so Next traces file deps correctly when
  // building inside a Docker context that includes packages/sdk via file:-link.
  outputFileTracingRoot: process.env.NEXT_OUTPUT_FILE_TRACING_ROOT,
};

export default nextConfig;
