import { LangPatternSet } from '../types.js';

export const rustPatterns: LangPatternSet = {
  ecosystem: 'rust',
  sourceExtensions: ['.rs'],
  configFileGlobs: ['Cargo.toml', '.cargo/config.toml', 'Rocket.toml'],
  portBindingPatterns: [
    {
      pattern: /\.bind\(\s*"[^"]*:(\d{4,5})"\s*\)/g,
      description: 'Actix/Hyper .bind() with hardcoded port',
    },
    {
      pattern: /TcpListener::bind\(\s*"[^"]*:(\d{4,5})"/g,
      description: 'TcpListener::bind with hardcoded port',
    },
    {
      pattern: /\.port\(\s*(\d{4,5})\s*\)/g,
      description: '.port() with hardcoded value',
    },
    {
      pattern: /^port\s*=\s*(\d{4,5})/gm,
      description: 'Rocket.toml port assignment',
    },
  ],
  buildOutputDirs: ['target'],
  cacheDirs: ['target/debug/incremental', 'target/release/incremental'],
  pidSocketPatterns: [],
  dbStringPatterns: [],
  logPathPatterns: [],
  fixTemplates: {
    'hardcoded-port': {
      sourcePattern: '$PORT',
      envVarPattern: 'std::env::var("PORT").unwrap_or_else(|_| "$ORIGINAL".to_string())',
      description: 'Use std::env::var with fallback',
    },
    'database-string': {
      sourcePattern: '$DB_URL',
      envVarPattern: 'std::env::var("DATABASE_URL").expect("DATABASE_URL must be set")',
      description: 'Use std::env::var("DATABASE_URL")',
    },
    'absolute-path': {
      sourcePattern: '$PATH',
      envVarPattern: 'PathBuf::from("$RELATIVE")',
      description: 'Use PathBuf with relative path',
    },
  },
};
