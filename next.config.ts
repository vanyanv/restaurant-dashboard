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
  // `next dev` prints every server action call with its arguments; the developer keys unlock takes a password.
  logging: { serverFunctions: false },
  experimental: {
    // @radix-ui/react-* used to fill this list — 17 entries, one per
    // component still on the pre-Counter design. All of them are gone from
    // package.json now (Counter's own primitives replaced Radix), so an
    // entry naming a package that isn't a dependency has nothing to
    // optimize; removed rather than left as dead config.
    optimizePackageImports: ["lucide-react", "date-fns"],
    // Keep a page the phone just showed for 30 s, so tapping back to the
    // previous tab or day shows it at once instead of asking the server again.
    // Next's default for dynamic pages is 0 s. A server action that calls
    // revalidatePath/revalidateTag, or a router.refresh(), clears it early.
    staleTimes: { dynamic: 30 },
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
