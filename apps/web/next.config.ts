import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  // SDK is installed via `file:../../packages/sdk`, which npm 10+ symlinks into
  // node_modules. webpack/Turbopack need explicit transpile for symlinked workspace-style
  // deps, otherwise `import('@bountymesh/sdk')` fails at runtime with "Cannot find
  // module" in dev (browser bundle).
  transpilePackages: ["@bountymesh/sdk"],

  // Standalone build output for Railway Docker deploy — copies a self-contained
  // server.js + minimal node_modules into .next/standalone, avoiding the full
  // node_modules tree in the production image.
  output: "standalone",

  // Set the monorepo root explicitly so Next traces file deps correctly when
  // building inside a Docker context that includes packages/sdk via file:-link.
  outputFileTracingRoot: process.env.NEXT_OUTPUT_FILE_TRACING_ROOT,

  // MDX route files (page.mdx alongside page.tsx)
  pageExtensions: ["ts", "tsx", "mdx"],
};

// Next 16 MDX plugins must be string identifiers (not imported
// function references. `[name, options]` tuple form passes options.
// (Librarian-verified — function form breaks Turbopack build with
// "loader does not have serializable options".)
const withMDX = createMDX({
  options: {
    remarkPlugins: ["remark-gfm"],
    rehypePlugins: [
      "rehype-slug",
      [
        "rehype-pretty-code",
        {
          theme: "github-dark-dimmed",
          keepBackground: false,
        },
      ],
      ["rehype-autolink-headings", { behavior: "wrap" }],
    ],
  },
});

export default withMDX(nextConfig);
