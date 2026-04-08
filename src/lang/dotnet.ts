import { LangPatternSet } from '../types.js';

export const dotnetPatterns: LangPatternSet = {
  ecosystem: 'dotnet',
  sourceExtensions: ['.cs', '.fs', '.vb'],
  configFileGlobs: [
    'appsettings.json', 'appsettings.*.json',
    'Properties/launchSettings.json', '*.csproj',
  ],
  portBindingPatterns: [
    {
      pattern: /UseUrls\([^)]*:(\d{4,5})/g,
      description: 'UseUrls with hardcoded port',
    },
    {
      pattern: /applicationUrl['"]\s*:\s*"[^"]*:(\d{4,5})/g,
      description: 'launchSettings applicationUrl with hardcoded port',
    },
    {
      pattern: /ASPNETCORE_URLS[=:][^"]*:(\d{4,5})/g,
      description: 'ASPNETCORE_URLS with hardcoded port',
    },
    {
      pattern: /"Url"\s*:\s*"[^"]*:(\d{4,5})"/g,
      description: 'Kestrel endpoint URL with hardcoded port',
    },
  ],
  buildOutputDirs: ['bin', 'obj', 'publish'],
  cacheDirs: [],
  pidSocketPatterns: [],
  dbStringPatterns: [
    {
      pattern: /Server\s*=\s*[^;]+;\s*Port\s*=\s*(\d+)/gi,
      description: '.NET connection string with hardcoded server/port',
    },
    {
      pattern: /"ConnectionStrings"\s*:\s*\{[^}]*"[^"]+"\s*:\s*"([^"]+)"/g,
      description: 'ConnectionStrings in appsettings.json',
    },
  ],
  logPathPatterns: [],
  fixTemplates: {
    'hardcoded-port': {
      sourcePattern: '$PORT',
      envVarPattern: 'Environment.GetEnvironmentVariable("PORT") ?? "$ORIGINAL"',
      description: 'Use Environment.GetEnvironmentVariable with fallback',
    },
    'database-string': {
      sourcePattern: '$DB_URL',
      envVarPattern: 'Configuration.GetConnectionString("DefaultConnection")',
      description: 'Use IConfiguration.GetConnectionString',
    },
    'absolute-path': {
      sourcePattern: '$PATH',
      envVarPattern: 'Path.Combine(AppContext.BaseDirectory, "$RELATIVE")',
      description: 'Use Path.Combine with AppContext.BaseDirectory',
    },
  },
};
