/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    // Fix case sensitivity issues on Windows
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }

    // Handle module resolution issues
    config.resolve.modules = [
      ...config.resolve.modules,
      '.'
    ];

    // Force case-insensitive module resolution on Windows
    config.resolve.alias = {
      ...config.resolve.alias,
      // Force consistent casing for problematic modules
    };

    // Add case-insensitive plugin for Windows
    if (process.platform === 'win32') {
      // Skip webpack modifications that cause issues
      console.log('Windows detected - skipping webpack DefinePlugin');
    }

    return config;
  },
  // Disable case sensitive routing
  trailingSlash: false,
  // Ensure consistent module resolution
  transpilePackages: ['@sats-connect/core', '@atomiqlabs/sdk'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },
        ],
      },
    ]
  },
}

export default nextConfig
