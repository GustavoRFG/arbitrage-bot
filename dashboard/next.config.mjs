/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // better-sqlite3 is a native module — keep it as an external server-only dep
    // so Next.js does not try to bundle it into the React server-component graph.
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  // Treat the dashboard as a fully dynamic, server-rendered app. Every page
  // hits SQLite at request time; we never want stale build-time data.
  output: 'standalone',
};

export default nextConfig;
