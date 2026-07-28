import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

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
  // The container image runs the standalone server, which bundles only the
  // modules the app actually imports and so does not need node_modules at
  // runtime. Opt-in via the environment rather than always on: a standalone
  // build traces and copies dependencies, which is wasted work for the local
  // dev loop and for CI, and `next start` is unaffected either way.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // Tracing starts at the app directory by default, which in a monorepo misses
  // the workspace packages and the root lockfile. Only relevant to a standalone
  // build; harmless otherwise.
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  // A dev server and a concurrent production build share .next by default and
  // corrupt each other's manifests, which shows up as an unexplained 500 with a
  // missing routes-manifest.json. Setting NEXT_DIST_DIR gives a parallel task
  // its own output directory. Unset, behaviour is unchanged.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Workspace packages ship as TypeScript source rather than as a build step,
  // so Next has to compile them itself.
  transpilePackages: ['@nidhi/core', '@nidhi/db'],
  // Satori reads the share-card fonts from disk at render time. Next's tracer
  // cannot see a runtime path join, so without this the fonts are missing from
  // a standalone deployment and every card renders in a fallback face.
  outputFileTracingIncludes: {
    '/opengraph-image': ['./src/assets/fonts/**'],
    '/ministry/[id]/opengraph-image': ['./src/assets/fonts/**'],
    '/scheme/[id]/opengraph-image': ['./src/assets/fonts/**'],
    '/state/[id]/opengraph-image': ['./src/assets/fonts/**'],
  },
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
        // Everything except /embed refuses framing. The embed routes exist to
        // be framed by newsrooms, and middleware grants them
        // frame-ancestors *; leaving the legacy X-Frame-Options header on them
        // as well would only confuse whoever debugs the pair later.
        source: '/((?!embed|hi/embed).*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
      {
        source: '/(embed|hi/embed)/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
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

// The Sentry build plugin is what turns sentry.client.config.ts into the
// client bundle's first import and uploads source maps; without this wrapper
// that file would sit on disk unused. It needs no secrets to do the former.
// Source-map upload additionally needs SENTRY_AUTH_TOKEN/SENTRY_ORG/
// SENTRY_PROJECT, none of which are declared in .env.example (docs/09 keeps
// Sentry itself optional), so upload is left disabled and the plugin degrades
// to "load the config files" with a one-line notice instead of an error.
export default withSentryConfig(config, {
  silent: true,
  disableLogger: true,
  sourcemaps: { disable: true },
  telemetry: false,
});
