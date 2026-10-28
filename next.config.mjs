
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep heavy / native / optional packages out of the bundle.
  serverExternalPackages: [
    'playwright',
    'playwright-core',
    'exceljs',
    'cheerio',
  ],

  poweredByHeader: false,
};

export default nextConfig;
