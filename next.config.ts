import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Old / guessed URLs resolve to the real workflow pages instead of 404.
  async redirects() {
    return [
      { source: "/home", destination: "/", permanent: false },
      { source: "/scan", destination: "/registration", permanent: false },
      { source: "/register", destination: "/registration/new", permanent: false },
      { source: "/desk", destination: "/distribution", permanent: false },
    ];
  },
  async headers() {
    // The service worker must always be revalidated so a new build can take over.
    return [
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
      { source: "/precache-manifest.json", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
