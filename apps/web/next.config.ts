import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@fdm/shared", "@fdm/database"],
};

export default nextConfig;
