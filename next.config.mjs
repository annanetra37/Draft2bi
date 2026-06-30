/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow remote image hosts (Cloudinary / S3) in production. Local demo uses
  // base64 data URLs and the /uploads route, which need no allowlisting.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
