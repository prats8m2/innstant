import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The app runs as a persistent Node process on Railway, not serverless.
  // Long-lived DB pools, SSE connections and in-process schedulers depend on
  // this. See CLAUDE.md "Stack" and D-002.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // Linting is a separate CI step (`pnpm lint`); don't run it twice on build.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
