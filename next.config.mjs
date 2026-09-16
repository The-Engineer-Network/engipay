/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a verification build run beside `next dev` without both writing to
  // .next, which corrupts the build (PageNotFoundError, ENOENT).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }

    // @coinbase/cdp-sdk (pulled in transitively by RainbowKit's Base
    // connector) declares the @x402/* packages as *optional* peers. They are
    // not installed and none of our code paths reach them, but webpack still
    // tries to resolve the import sites, which fails the build.
    config.plugins.push(
      new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// })
    );

    // Optional peers of the MetaMask SDK (React Native only) and pino's
    // pretty-printer. Neither is used in the browser build.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
      'pino-pretty': false,
    };

    return config;
  },
  transpilePackages: ['@rainbow-me/rainbowkit'],
};

export default nextConfig;
