import { LangPatternSet } from '../types.js';

export const cppPatterns: LangPatternSet = {
  ecosystem: 'cpp',
  sourceExtensions: ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx'],
  configFileGlobs: [
    'CMakeLists.txt', 'Makefile', 'Makefile.*',
    'meson.build', 'conanfile.txt', 'conanfile.py',
    'vcpkg.json',
  ],
  portBindingPatterns: [
    {
      pattern: /bind\([^,]+,\s*(\d{4,5})\s*\)/g,
      description: 'Socket bind() with hardcoded port',
    },
    {
      pattern: /htons\(\s*(\d{4,5})\s*\)/g,
      description: 'htons() with hardcoded port',
    },
    {
      pattern: /listen_on\(\s*(\d{4,5})\s*\)/g,
      description: 'Server listen_on with hardcoded port',
    },
  ],
  buildOutputDirs: [
    'build', 'cmake-build-debug', 'cmake-build-release',
    'out', 'bin', 'obj',
  ],
  cacheDirs: [
    'build', 'cmake-build-debug', 'cmake-build-release',
    '.cache',
  ],
  pidSocketPatterns: [],
  dbStringPatterns: [],
  logPathPatterns: [],
  fixTemplates: {
    'hardcoded-port': {
      sourcePattern: '$PORT',
      envVarPattern: 'atoi(getenv("PORT") ? getenv("PORT") : "$ORIGINAL")',
      description: 'Use getenv("PORT") with fallback',
    },
    'absolute-path': {
      sourcePattern: '$PATH',
      envVarPattern: '"./$RELATIVE"',
      description: 'Use relative path',
    },
  },
};
