import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits a minimal .next/standalone runtime (server.js + only the
  // node_modules actually traced as used) instead of requiring the full
  // node_modules tree at runtime -- the production Docker image
  // (Dockerfile.prod) copies just that output, not the whole build
  // context. No effect on `next dev`.
  output: "standalone",
};

export default nextConfig;
