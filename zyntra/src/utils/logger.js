const levels = { info: '✅', warn: '⚠️', error: '❌', debug: '🔍' };

const logger = {
  info: (msg, ...args) => console.log(`[${new Date().toISOString()}] ${levels.info} INFO:`, msg, ...args),
  warn: (msg, ...args) => console.warn(`[${new Date().toISOString()}] ${levels.warn} WARN:`, msg, ...args),
  error: (msg, ...args) => console.error(`[${new Date().toISOString()}] ${levels.error} ERROR:`, msg, ...args),
  debug: (msg, ...args) => {
    if (process.env.DEBUG === 'true') {
      console.log(`[${new Date().toISOString()}] ${levels.debug} DEBUG:`, msg, ...args);
    }
  },
};

module.exports = logger;
