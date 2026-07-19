import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// The monorepo keeps one .env at the root, shared by the web app, the database
// tooling and the Python pipelines. Next only looks inside the app directory,
// so the root file is loaded here explicitly. Missing is fine: a deployment
// supplies real environment variables instead.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship as TypeScript source rather than as a build step,
  // so Next has to compile them itself.
  transpilePackages: ['@nidhi/core', '@nidhi/db'],
  experimental: {
    // Charts and icons are large; pulling only what a page imports keeps the
    // ministry pages inside the LCP budget in docs/06.
    optimizePackageImports: ['lucide-react', 'echarts'],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
      {
        // The public read-only API is meant to be consumed from anywhere; the
        // rest of the app is not (docs/02 section 7).
        source: '/api/v1/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
        ],
      },
    ];
  },
};

export default config;
