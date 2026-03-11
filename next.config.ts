import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const isProd = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  output: "export",
  // GitHub Pages usually deploys to a sub-path /sticker-remove-bg/
  // This environment variable is injected by our deploy.yml workflow
  basePath: process.env.GITHUB_PAGES_BASE_PATH || "",
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default withNextIntl(nextConfig);
