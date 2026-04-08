import { LangPatternSet } from '../types.js';

export const javaPatterns: LangPatternSet = {
  ecosystem: 'java',
  sourceExtensions: ['.java', '.kt', '.scala'],
  configFileGlobs: [
    'application.properties', 'application*.yml', 'application*.yaml',
    'pom.xml', 'build.gradle', 'build.gradle.kts',
    'logback.xml', 'log4j2.xml',
  ],
  portBindingPatterns: [
    {
      pattern: /server\.port\s*=\s*(\d{4,5})/g,
      description: 'Spring server.port with hardcoded value',
    },
    {
      pattern: /new\s+ServerSocket\(\s*(\d{4,5})\s*\)/g,
      description: 'ServerSocket with hardcoded port',
    },
    {
      pattern: /<port>(\d{4,5})<\/port>/g,
      description: 'Port in XML config',
    },
  ],
  buildOutputDirs: ['target', 'build', 'out'],
  cacheDirs: ['.gradle'],
  pidSocketPatterns: [
    {
      pattern: /application\.pid|catalina\.pid/g,
      description: 'Java application PID file',
    },
  ],
  dbStringPatterns: [
    {
      pattern: /spring\.datasource\.url\s*=\s*(.+)/g,
      description: 'Spring datasource URL with hardcoded connection string',
    },
    {
      pattern: /jdbc:[a-z]+:\/\/[^\s"']+/g,
      description: 'JDBC URL with hardcoded connection details',
    },
  ],
  logPathPatterns: [
    {
      pattern: /<file>([^<]+\.log)<\/file>/g,
      description: 'Hardcoded log file path in logback/log4j',
    },
  ],
  fixTemplates: {
    'hardcoded-port': {
      sourcePattern: '$PORT',
      envVarPattern: '${server.port:$ORIGINAL}',
      description: 'Use Spring property placeholder with default',
    },
    'database-string': {
      sourcePattern: '$DB_URL',
      envVarPattern: '${DATABASE_URL}',
      description: 'Use Spring property placeholder for DB URL',
    },
    'absolute-path': {
      sourcePattern: '$PATH',
      envVarPattern: 'Paths.get("$RELATIVE")',
      description: 'Use Paths.get with relative path',
    },
  },
};
