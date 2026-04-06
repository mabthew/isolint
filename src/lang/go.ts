import { LangPatternSet } from '../types.js';

export const goPatterns: LangPatternSet = {
  ecosystem: 'go',
  sourceExtensions: ['.go'],
  configFileGlobs: ['config.yaml', 'config.toml', '.env', 'Makefile'],
  portBindingPatterns: [
    {
      pattern: /ListenAndServe\(\s*"[^"]*:(\d{4,5})"/g,
      description: 'http.ListenAndServe with hardcoded port',
    },
    {
      pattern: /net\.Listen\(\s*"[^"]*"\s*,\s*"[^"]*:(\d{4,5})"/g,
      description: 'net.Listen with hardcoded port',
    },
    {
      pattern: /\.Run\(\s*":(\d{4,5})"\s*\)/g,
      description: 'Gin/Fiber .Run() with hardcoded port',
    },
    {
      pattern: /\.Listen\(\s*":(\d{4,5})"\s*\)/g,
      description: 'Fiber .Listen() with hardcoded port',
    },
  ],
  buildOutputDirs: ['./build', './bin'],
  cacheDirs: [],
  pidSocketPatterns: [],
  dbStringPatterns: [],
  logPathPatterns: [],
  fixTemplates: {
    'hardcoded-port': {
      sourcePattern: '$PORT',
      envVarPattern: 'os.Getenv("PORT")',
      description: 'Use os.Getenv with fallback',
    },
  },
};
