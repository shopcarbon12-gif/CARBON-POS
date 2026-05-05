import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg", "node-thermal-printer", "bcryptjs"],
};

export default nextConfig;
