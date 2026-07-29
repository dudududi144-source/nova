import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // Allow the preview gateway origin to access the dev server
  allowedDevOrigins: ["https://preview-chat-dc1fb2f6-89e3-4024-9cca-d9323b5fe643.space-z.ai"],
};

export default nextConfig;
