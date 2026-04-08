import { LangPatternSet } from '../types.js';

export const rubyPatterns: LangPatternSet = {
  ecosystem: 'ruby',
  sourceExtensions: ['.rb', '.rake'],
  configFileGlobs: [
    'config/database.yml', 'config/puma.rb', 'config/cable.yml',
    'config/environments/*.rb', 'Procfile',
  ],
  portBindingPatterns: [
    {
      pattern: /config\.port\s*=\s*(\d{4,5})/g,
      description: 'Rails config.port with hardcoded value',
    },
    {
      pattern: /bind\s+["']tcp:\/\/[^:]*:(\d{4,5})/g,
      description: 'Puma bind with hardcoded port',
    },
    {
      pattern: /-p\s+(\d{4,5})/g,
      description: 'Procfile with hardcoded port flag',
      contextKeywords: ['puma', 'rails', 'unicorn', 'thin', 'web:'],
    },
  ],
  buildOutputDirs: [],
  cacheDirs: ['tmp/cache'],
  pidSocketPatterns: [
    {
      pattern: /tmp\/pids\/server\.pid|tmp\/sockets\/puma\.sock/g,
      description: 'Rails PID/socket file (classic worktree conflict)',
    },
  ],
  dbStringPatterns: [
    {
      pattern: /database:\s*["']?(\w+)["']?/g,
      description: 'Database name in database.yml',
      contextKeywords: ['development', 'production', 'test'],
    },
  ],
  logPathPatterns: [
    {
      pattern: /log\/[\w-]+\.log/g,
      description: 'Hardcoded log file path',
    },
  ],
  fixTemplates: {
    'hardcoded-port': {
      sourcePattern: '$PORT',
      envVarPattern: "ENV.fetch('PORT', $ORIGINAL)",
      description: "Use ENV.fetch('PORT') with fallback",
    },
    'database-string': {
      sourcePattern: '$DB_URL',
      envVarPattern: "ENV.fetch('DATABASE_URL')",
      description: "Use ENV.fetch('DATABASE_URL')",
    },
    'absolute-path': {
      sourcePattern: '$PATH',
      envVarPattern: "Rails.root.join('$RELATIVE')",
      description: 'Use Rails.root.join with relative path',
    },
  },
};
