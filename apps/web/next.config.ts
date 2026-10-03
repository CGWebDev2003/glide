import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The recorder drives Playwright/Chromium and ffmpeg: load it from node_modules
  // at runtime instead of bundling it (the in-page runtime is serialized with
  // Function.prototype.toString and must not be transformed).
  serverExternalPackages: ['playwright', 'playwright-core'],
  devIndicators: false,
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
    ];
  },
};

export default nextConfig;
