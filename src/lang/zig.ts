import { LangPatternSet } from '../types.js';

export const zigPatterns: LangPatternSet = {
  ecosystem: 'zig',
  sourceExtensions: ['.zig'],
  configFileGlobs: ['build.zig', 'build.zig.zon'],
  portBindingPatterns: [
    {
      pattern: /\.listen\(.*,\s*(\d{4,5})\s*\)/g,
      description: 'std.net listen with hardcoded port',
    },
    {
      pattern: /port\s*=\s*(\d{4,5})/g,
      description: 'Port assignment with hardcoded value',
      contextKeywords: ['address', 'server', 'listen', 'bind', 'net'],
    },
  ],
  buildOutputDirs: ['zig-out', 'zig-cache'],
  cacheDirs: ['zig-cache', '.zig-cache'],
  pidSocketPatterns: [],
  dbStringPatterns: [],
  logPathPatterns: [],
  fixTemplates: {
    'hardcoded-port': {
      sourcePattern: '$PORT',
      envVarPattern: 'std.process.getEnvMap().get("PORT") orelse "$ORIGINAL"',
      description: 'Use std.process.getEnvMap for PORT',
    },
    'absolute-path': {
      sourcePattern: '$PATH',
      envVarPattern: '"$RELATIVE"',
      description: 'Use relative path',
    },
  },
};
