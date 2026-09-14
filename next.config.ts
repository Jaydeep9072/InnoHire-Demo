import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["oracledb", "oci-common", "oci-objectstorage", "oci-aispeech"],
};

export default nextConfig;
