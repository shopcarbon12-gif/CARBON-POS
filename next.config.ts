import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg", "node-thermal-printer", "bcryptjs"],
  // Allow the dev server's HMR + font assets to be loaded by other devices
  // on the LAN (e.g. tablet at 192.168.1.214 hitting our laptop on :5000).
  // Production traffic goes through Coolify so this is a dev-only knob.
  allowedDevOrigins: ["192.168.1.214"],
};

export default nextConfig;
