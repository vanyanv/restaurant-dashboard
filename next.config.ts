import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: {
    "/": ["./prisma/**/*"],
  },
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  reactCompiler: true,
  experimental: {
    // @radix-ui/react-* used to fill this list — 17 entries, one per
    // component still on the pre-Counter design. All of them are gone from
    // package.json now (Counter's own primitives replaced Radix), so an
    // entry naming a package that isn't a dependency has nothing to
    // optimize; removed rather than left as dead config.
    optimizePackageImports: ["lucide-react", "recharts", "framer-motion", "date-fns"],
  },
  images: {
    formats: ["image/webp", "image/avif"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [],
  },
  compress: true,
  generateEtags: true,
  poweredByHeader: false,
};

export default withBundleAnalyzer(nextConfig);
