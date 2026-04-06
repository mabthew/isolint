/**
 * Universal cross-language patterns and heuristics.
 * Language-specific modules build on these.
 */

/** Port numbers that are almost certainly intentional server ports. */
export const WELL_KNOWN_DEV_PORTS = new Set([
  3000, 3001, 3002, 3003, 3010, 3030, 3100,
  4000, 4200, 4300, 4321,
  5000, 5001, 5173, 5174, 5500,
  6000, 6006,
  7000, 7070,
  8000, 8001, 8080, 8081, 8443, 8888,
  9000, 9090, 9229,
]);

/** Well-known database/service ports. */
export const WELL_KNOWN_SERVICE_PORTS = new Set([
  5432,   // PostgreSQL
  3306,   // MySQL
  27017,  // MongoDB
  6379,   // Redis
  1433,   // MSSQL
  9200,   // Elasticsearch
  5672,   // RabbitMQ
  11211,  // Memcached
  2181,   // Zookeeper
  4222,   // NATS
]);

/** Keywords that suggest a number is used as a port. */
export const PORT_CONTEXT_KEYWORDS = [
  'port', 'PORT', 'listen', 'bind', 'expose',
  'proxy_pass', 'localhost', '127.0.0.1', '0.0.0.0',
  'host', 'server', 'addr', 'address', 'url', 'URL',
  'endpoint', 'upstream', 'ASPNETCORE_URLS',
];

/** Keywords that suggest a number is NOT a port. */
export const PORT_NEGATIVE_KEYWORDS = [
  'setTimeout', 'setInterval', 'delay', 'timeout', 'interval',
  'sleep', 'Thread.sleep', 'time.Sleep', 'Duration',
  'status', 'statusCode', 'HttpStatus', 'StatusCode',
  'width', 'height', 'size', 'length', 'count', 'index', 'offset',
  'year', 'month', 'day', 'date', 'timestamp',
  'version', 'rgba', 'rgb', 'hsl',
  'margin', 'padding', 'fontSize', 'font-size',
  'maxRetries', 'retries', 'attempts', 'max_retries',
  'buffer', 'chunk', 'batch', 'limit', 'pageSize',
  'weight', 'score', 'priority', 'order',
];

/** Absolute path prefixes that indicate a hardcoded enlistment root. */
export const HARDCODED_PATH_PREFIXES = [
  /\/Users\/\w+\//,
  /\/home\/\w+\//,
  /C:\\Users\\\w+\\/,
  /D:\\[^\\]+\\/,
  /\/var\/www\/\w+/,
  /\/opt\/\w+\/\w+/,
  /\/srv\/\w+/,
];

/** Absolute paths that are safe/expected (not hardcoded enlistments). */
export const SAFE_PATH_PREFIXES = [
  '/usr/', '/etc/', '/var/lib/', '/var/log/', '/var/run/',
  '/dev/', '/proc/', '/sys/', '/tmp/', '/bin/', '/sbin/',
  '/lib/', '/lib64/', '/run/',
  '/snap/', '/nix/',
];

/** Universal database URL pattern. */
export const DB_URL_PATTERN =
  /(postgresql|postgres|mysql|mongodb(?:\+srv)?|redis(?:s)?|amqp(?:s)?|mssql|sqlite):\/\/[^\s"'`,;)}\]]{1,500}/g;

/** Docker-compose port mapping pattern. */
export const DOCKER_PORTS_PATTERN = /^\s*-\s*["']?(\d{4,5}):(\d{4,5})["']?\s*$/gm;

/** Docker container_name pattern. */
export const DOCKER_CONTAINER_NAME_PATTERN = /^\s*container_name:\s*["']?([^"'\s#]+)/gm;

/**
 * Checks whether a given line of code has port context.
 * Returns true if the number is likely a port, false if likely not.
 */
export function hasPortContext(line: string): boolean {
  const lower = line.toLowerCase();
  // Check negative context first
  for (const neg of PORT_NEGATIVE_KEYWORDS) {
    if (line.includes(neg) || lower.includes(neg.toLowerCase())) return false;
  }
  // Check positive context
  for (const kw of PORT_CONTEXT_KEYWORDS) {
    if (line.includes(kw) || lower.includes(kw.toLowerCase())) return true;
  }
  return false;
}

/**
 * Checks whether a port number is in a well-known range.
 */
export function isLikelyPort(port: number): boolean {
  if (WELL_KNOWN_DEV_PORTS.has(port)) return true;
  if (WELL_KNOWN_SERVICE_PORTS.has(port)) return true;
  // Common dev port ranges
  if (port >= 3000 && port <= 3999) return true;
  if (port >= 4000 && port <= 4999) return true;
  if (port >= 5000 && port <= 5999) return true;
  if (port >= 8000 && port <= 8999) return true;
  if (port >= 9000 && port <= 9999) return true;
  return false;
}
