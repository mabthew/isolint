import { LangPatternSet } from '../types.js';

export const elixirPatterns: LangPatternSet = {
  ecosystem: 'elixir',
  sourceExtensions: ['.ex', '.exs'],
  configFileGlobs: [
    'config/dev.exs', 'config/config.exs', 'config/runtime.exs',
    'config/prod.exs', 'config/test.exs',
  ],
  portBindingPatterns: [
    {
      pattern: /port:\s*(\d{4,5})/g,
      description: 'Phoenix/Plug port with hardcoded value',
      contextKeywords: ['http', 'endpoint', 'cowboy', 'bandit', 'plug'],
    },
    {
      pattern: /Plug\.Cowboy,\s*scheme.*port:\s*(\d{4,5})/g,
      description: 'Plug.Cowboy with hardcoded port',
    },
  ],
  buildOutputDirs: ['_build', 'deps'],
  cacheDirs: ['_build', 'deps'],
  pidSocketPatterns: [],
  dbStringPatterns: [
    {
      pattern: /url:\s*"(?:postgres|mysql|ecto):\/\/[^"]+"/g,
      description: 'Ecto database URL with hardcoded connection',
    },
    {
      pattern: /hostname:\s*"([^"]+)"/g,
      description: 'Ecto database hostname',
      contextKeywords: ['Repo', 'database', 'username', 'password'],
    },
  ],
  logPathPatterns: [],
  fixTemplates: {
    'hardcoded-port': {
      sourcePattern: '$PORT',
      envVarPattern: 'String.to_integer(System.get_env("PORT") || "$ORIGINAL")',
      description: 'Use System.get_env("PORT") with fallback',
    },
    'database-string': {
      sourcePattern: '$DB_URL',
      envVarPattern: 'System.get_env("DATABASE_URL")',
      description: 'Use System.get_env("DATABASE_URL")',
    },
    'absolute-path': {
      sourcePattern: '$PATH',
      envVarPattern: 'Path.join(File.cwd!(), "$RELATIVE")',
      description: 'Use Path.join with File.cwd!()',
    },
  },
};
