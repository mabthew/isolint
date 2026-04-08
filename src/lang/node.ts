import { LangPatternSet } from '../types.js';

export const nodePatterns: LangPatternSet = {
  ecosystem: 'node',
  sourceExtensions: ['.ts', '.js', '.tsx', '.jsx', '.mts', '.mjs', '.cjs'],
  configFileGlobs: [
    '.env*', 'next.config.*', 'vite.config.*', 'nuxt.config.*',
    'webpack.config.*', 'angular.json', 'svelte.config.*',
    'astro.config.*', 'remix.config.*',
  ],
  portBindingPatterns: [
    {
      pattern: /\.listen\(\s*(\d{4,5})\s*[,)]/g,
      description: 'Server .listen() with hardcoded port',
    },
    {
      pattern: /port\s*[:=]\s*(\d{4,5})\b/gi,
      description: 'Port assignment with hardcoded value',
    },
    {
      pattern: /localhost:(\d{4,5})/g,
      description: 'Hardcoded localhost URL with port',
    },
    {
      pattern: /127\.0\.0\.1:(\d{4,5})/g,
      description: 'Hardcoded loopback URL with port',
    },
    {
      pattern: /0\.0\.0\.0:(\d{4,5})/g,
      description: 'Hardcoded bind-all URL with port',
    },
  ],
  buildOutputDirs: [
    'dist', 'build', '.next', '.nuxt', '.output', 'out',
    '.svelte-kit', '.astro', '.angular',
  ],
  cacheDirs: [
    'node_modules/.cache', '.next/cache', '.turbo',
    '.parcel-cache', '.eslintcache', '.stylelintcache',
    '.vite',
  ],
  pidSocketPatterns: [],
  dbStringPatterns: [
    {
      pattern: /DATABASE_URL\s*=\s*["']?([^\s"']+)/g,
      description: 'DATABASE_URL with hardcoded connection string',
    },
  ],
  logPathPatterns: [],
  fixTemplates: {
    'hardcoded-port': {
      sourcePattern: '$PORT',
      envVarPattern: "parseInt(process.env.PORT || '$ORIGINAL', 10)",
      description: 'Use process.env.PORT with fallback',
    },
    'database-string': {
      sourcePattern: '$DB_URL',
      envVarPattern: "process.env.DATABASE_URL || '$ORIGINAL'",
      description: 'Use process.env.DATABASE_URL with fallback',
    },
    'absolute-path': {
      sourcePattern: '$PATH',
      envVarPattern: "path.resolve(__dirname, '$RELATIVE')",
      description: 'Use path.resolve with __dirname',
    },
  },
};
