import { LangPatternSet } from '../types.js';

export const phpPatterns: LangPatternSet = {
  ecosystem: 'php',
  sourceExtensions: ['.php'],
  configFileGlobs: [
    '.env', '.env.example', 'config/app.php', 'config/database.php',
    'docker-compose.yml', 'artisan',
  ],
  portBindingPatterns: [
    {
      pattern: /artisan\s+serve.*--port[=\s]+(\d{4,5})/g,
      description: 'Artisan serve with hardcoded port',
    },
    {
      pattern: /APP_PORT\s*=\s*(\d{4,5})/g,
      description: 'APP_PORT with hardcoded value',
    },
    {
      pattern: /localhost:(\d{4,5})/g,
      description: 'Hardcoded localhost URL with port',
    },
  ],
  buildOutputDirs: ['vendor', 'public/build', 'bootstrap/cache'],
  cacheDirs: [
    'storage/framework/cache', 'storage/framework/views',
    'storage/framework/sessions', 'bootstrap/cache',
  ],
  pidSocketPatterns: [],
  dbStringPatterns: [
    {
      pattern: /DB_CONNECTION\s*=\s*(\w+)/g,
      description: 'Laravel DB connection type',
    },
    {
      pattern: /DB_HOST\s*=\s*([^\s]+)/g,
      description: 'Laravel DB host',
    },
  ],
  logPathPatterns: [
    {
      pattern: /storage\/logs\/[\w-]+\.log/g,
      description: 'Hardcoded Laravel log path',
    },
  ],
  fixTemplates: {
    'hardcoded-port': {
      sourcePattern: '$PORT',
      envVarPattern: "env('APP_PORT', $ORIGINAL)",
      description: "Use env('APP_PORT') with fallback",
    },
    'database-string': {
      sourcePattern: '$DB_URL',
      envVarPattern: "env('DATABASE_URL')",
      description: "Use env('DATABASE_URL')",
    },
    'absolute-path': {
      sourcePattern: '$PATH',
      envVarPattern: "base_path('$RELATIVE')",
      description: 'Use base_path() with relative path',
    },
  },
};
