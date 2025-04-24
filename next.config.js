// Add transpiled dependency handling for Edge compatibility
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
  experimental: {
    webpackBuildWorker: true,
    parallelServerBuildTraces: true,
    parallelServerCompiles: true,
  },
  // Using serverExternalPackages instead of experimental.serverComponentsExternalPackages
  serverExternalPackages: ['@prisma/client', 'node-fetch'],
  // Add this line to enable the edge runtime
  serverRuntimeConfig: {
    PROJECT_ROOT: __dirname
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Handle node.js built-ins for Edge runtime
      if (typeof config.resolve.fallback !== 'object') {
        config.resolve.fallback = {};
      }

      Object.assign(config.resolve.fallback, {
        fs: false,
        net: false,
        tls: false,
        http2: false,
        child_process: false,
      });
    }
    
    return config;}
  ,
  assetPrefix:'/tools/shadow-it-scan',
}

// Handle optional user config merging
let userConfig = {};
try {
  userConfig = require('./v0-user-next.config.js');
} catch (e) {
  // ignore error if file doesn't exist
}

// Deep merge configurations
function mergeConfigs(nextConfig, userConfig) {
  if (!userConfig) return nextConfig;

  const merged = { ...nextConfig };
  
  Object.keys(userConfig).forEach(key => {
    if (typeof userConfig[key] === 'object' && !Array.isArray(userConfig[key]) && nextConfig[key]) {
      merged[key] = mergeConfigs(nextConfig[key], userConfig[key]);
    } else {
      merged[key] = userConfig[key];
    }
  });
  
  return merged;
}

// Export merged config
module.exports = mergeConfigs(nextConfig, userConfig);
