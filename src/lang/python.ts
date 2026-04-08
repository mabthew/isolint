import { LangPatternSet } from '../types.js';

export const pythonPatterns: LangPatternSet = {
  ecosystem: 'python',
  sourceExtensions: ['.py'],
  configFileGlobs: [
    'settings.py', 'config.py', 'gunicorn.conf.py',
    'pyproject.toml', 'alembic.ini', 'uwsgi.ini',
  ],
  portBindingPatterns: [
    {
      pattern: /\.run\([^)]*port\s*=\s*(\d{4,5})/g,
      description: 'Flask/FastAPI .run() with hardcoded port',
    },
    {
      pattern: /uvicorn\.run\([^)]*port\s*=\s*(\d{4,5})/g,
      description: 'Uvicorn run with hardcoded port',
    },
    {
      pattern: /bind\s*=\s*["'][^"']*:(\d{4,5})["']/g,
      description: 'Gunicorn bind with hardcoded port',
    },
  ],
  buildOutputDirs: ['dist', 'build'],
  cacheDirs: [
    '__pycache__', '.mypy_cache', '.pytest_cache',
    '.ruff_cache', '.tox', '.nox',
  ],
  pidSocketPatterns: [
    {
      pattern: /gunicorn\.pid|celery.*\.pid|celerybeat\.pid/g,
      description: 'Hardcoded PID file path',
    },
  ],
  dbStringPatterns: [
    {
      pattern: /SQLALCHEMY_DATABASE_URI\s*=\s*["']([^"']+)["']/g,
      description: 'SQLAlchemy database URI with hardcoded connection string',
    },
    {
      pattern: /sqlalchemy\.url\s*=\s*(.+)/g,
      description: 'Alembic database URL',
    },
  ],
  logPathPatterns: [],
  fixTemplates: {
    'hardcoded-port': {
      sourcePattern: '$PORT',
      envVarPattern: "int(os.environ.get('PORT', $ORIGINAL))",
      description: 'Use os.environ.get with fallback',
    },
    'database-string': {
      sourcePattern: '$DB_URL',
      envVarPattern: "os.environ.get('DATABASE_URL', '$ORIGINAL')",
      description: "Use os.environ.get('DATABASE_URL')",
    },
    'absolute-path': {
      sourcePattern: '$PATH',
      envVarPattern: "Path('$RELATIVE')",
      description: 'Use pathlib.Path with relative path',
    },
  },
};
