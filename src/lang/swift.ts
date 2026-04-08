import { LangPatternSet } from '../types.js';

export const swiftPatterns: LangPatternSet = {
  ecosystem: 'swift',
  sourceExtensions: ['.swift'],
  configFileGlobs: [
    'Package.swift', '*.xcodeproj', '*.xcworkspace',
  ],
  portBindingPatterns: [
    {
      pattern: /\.listen\(\s*port:\s*(\d{4,5})/g,
      description: 'Vapor .listen with hardcoded port',
    },
    {
      pattern: /app\.http\.server\.configuration\.port\s*=\s*(\d{4,5})/g,
      description: 'Vapor server port configuration',
    },
    {
      pattern: /NWEndpoint\.Port\(\s*rawValue:\s*(\d{4,5})/g,
      description: 'NWEndpoint.Port with hardcoded value',
    },
  ],
  buildOutputDirs: [
    '.build', 'DerivedData', 'Build',
    '.swiftpm',
  ],
  cacheDirs: [
    'DerivedData', '.build',
  ],
  pidSocketPatterns: [],
  dbStringPatterns: [],
  logPathPatterns: [],
  fixTemplates: {
    'hardcoded-port': {
      sourcePattern: '$PORT',
      envVarPattern: 'Int(Environment.get("PORT") ?? "$ORIGINAL")!',
      description: 'Use Environment.get("PORT") with fallback',
    },
    'absolute-path': {
      sourcePattern: '$PATH',
      envVarPattern: 'Bundle.main.resourcePath! + "/$RELATIVE"',
      description: 'Use Bundle.main.resourcePath with relative path',
    },
  },
};
