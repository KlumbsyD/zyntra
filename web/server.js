const express = require('express');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const plex = require('../src/plex');
const logger = require('../src/utils/logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if s looks like a Discord snowflake (17–20 digit numeric string) */
function isValidSnowflake(s) {
  return typeof s === 'string' && /^\d{17,20}$/.test(s);
}

/** Generic error reply that never leaks internal detail */
function serverError(res, label) {
  logger.error(`API error: ${label}`);
  res.status(500).json({ error: 'Internal server error' });
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

const WEB_PASSWORD = process.env.WEB_PASSWORD || '';

/**
 * Simple session token auth.
 * If WEB_PASSWORD is set, all /api/* routes require a valid session token
 * obtained by POST /api/login with the correct password.
 * Tokens are stored in memory and expire after 24h.
 */
const sessions = new Map(); // token -> expiresAt

function requireAuth(req, res, next) {
  if (!WEB_PASSWORD) return next(); // auth disabled if no password set

  const token = req.headers['x-session-token'] || req.query._token;
  if (!token || !sessions.has(token) || sessions.get(token) < Date.now()) {
    if (token) sessions.delete(token); // clean up expired
    return res.status(401).json({ error: 'Unauthorized. Please log in at /login.' });
  }
  next();
}

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [token, exp] of sessions.entries()) {
    if (exp < now) sessions.delete(token);
  }
}

// ─── Rate limiters ────────────────────────────────────────────────────────────

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  message: { error: 'Too many requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Search rate limit exceeded. Wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Server ───────────────────────────────────────────────────────────────────

function startWebServer(client) {
  const app = express();
  const port = process.env.WEB_PORT || 3333;

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // needed for inline script in dashboard
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  }));

  // Body parsing with size limit
  app.use(express.json({ limit: '16kb' }));

  // Apply general rate limit to all API routes
  app.use('/api/', apiLimiter);

  // Static files
  app.use(express.static(path.join(__dirname, 'public')));

  // ── Login ──────────────────────────────────────────────────────────────────
  app.post('/api/login', loginLimiter, (req, res) => {
    if (!WEB_PASSWORD) return res.json({ ok: true, message: 'Auth disabled' });

    const { password } = req.body;
    if (typeof password !== 'string') return res.status(400).json({ error: 'Missing password' });

    // Constant-time comparison to prevent timing attacks
    const expected = Buffer.from(WEB_PASSWORD);
    const given = Buffer.from(password.slice(0, 256)); // cap length
    const match = expected.length === given.length &&
      crypto.timingSafeEqual(expected, given);

    if (!match) {
      return res.status(403).json({ error: 'Incorrect password' });
    }

    cleanExpiredSessions();
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + 24 * 60 * 60 * 1000); // 24h
    res.json({ ok: true, token });
  });

  app.get('/api/auth-required', (req, res) => {
    res.json({ required: !!WEB_PASSWORD });
  });

  // ── Status ─────────────────────────────────────────────────────────────────
  app.get('/api/status', requireAuth, (req, res) => {
    try {
      const guilds = [];
      for (const [guildId, q] of client.queue.entries()) {
        const guild = client.guilds.cache.get(guildId);
        const status = q.getStatus();
        // Strip thumb from queue items — they contain Plex paths, not tokens,
        // but we don't need them in the web UI anyway
        const safeQueue = (status.queue || []).map(({ thumb, ...rest }) => rest);
        const safeTrack = status.currentTrack
          ? (({ thumb, ...rest }) => rest)(status.currentTrack)
          : null;
        guilds.push({
          guildId,
          guildName: guild?.name || 'Unknown Server',
          ...status,
          currentTrack: safeTrack,
          queue: safeQueue,
        });
      }
      res.json({
        botReady: client.isReady(),
        botTag: client.user?.tag || null,
        guilds,
      });
    } catch (err) {
      serverError(res, err.message);
    }
  });

  app.get('/api/plex/status', requireAuth, async (req, res) => {
    try {
      const ok = await plex.testConnection();
      // Return method but NOT the URL (could reveal internal network topology)
      res.json({ connected: ok, method: plex.authMethod });
    } catch (err) {
      serverError(res, err.message);
    }
  });

  // ── Plex Search ─────────────────────────────────────────────────────────────
  app.get('/api/search', requireAuth, searchLimiter, async (req, res) => {
    try {
      const q = req.query.q;
      if (!q || typeof q !== 'string') return res.json([]);
      const sanitized = q.slice(0, 200); // cap query length
      const results = await plex.search(sanitized);
      // Strip thumb paths from search results sent to web client
      const safe = results.slice(0, 20).map(({ thumb, ...rest }) => rest);
      res.json(safe);
    } catch (err) {
      serverError(res, err.message);
    }
  });

  app.get('/api/playlists', requireAuth, async (req, res) => {
    try {
      const playlists = await plex.getPlaylists();
      res.json(playlists);
    } catch (err) {
      serverError(res, err.message);
    }
  });

  app.get('/api/recently-added', requireAuth, async (req, res) => {
    try {
      const tracks = await plex.getRecentlyAdded(20);
      const safe = tracks.map(({ thumb, ...rest }) => rest);
      res.json(safe);
    } catch (err) {
      serverError(res, err.message);
    }
  });

  // ── Queue Control ──────────────────────────────────────────────────────────

  /** Middleware: validates :guildId is a Discord snowflake and queue exists */
  function resolveQueue(req, res, next) {
    if (!isValidSnowflake(req.params.guildId)) {
      return res.status(400).json({ error: 'Invalid guild ID' });
    }
    const q = client.queue.get(req.params.guildId);
    if (!q) return res.status(404).json({ error: 'No active queue for this server' });
    req.guildQueue = q;
    next();
  }

  app.post('/api/guild/:guildId/skip', requireAuth, resolveQueue, (req, res) => {
    req.guildQueue.skip();
    res.json({ ok: true });
  });

  app.post('/api/guild/:guildId/pause', requireAuth, resolveQueue, (req, res) => {
    req.guildQueue.pause();
    res.json({ ok: true });
  });

  app.post('/api/guild/:guildId/resume', requireAuth, resolveQueue, (req, res) => {
    req.guildQueue.resume();
    res.json({ ok: true });
  });

  app.post('/api/guild/:guildId/volume', requireAuth, resolveQueue, (req, res) => {
    const vol = Number(req.body.volume);
    if (!Number.isFinite(vol) || vol < 0 || vol > 100) {
      return res.status(400).json({ error: 'Volume must be a number between 0 and 100' });
    }
    req.guildQueue.setVolume(vol / 100);
    res.json({ ok: true, volume: vol });
  });

  app.post('/api/guild/:guildId/shuffle', requireAuth, resolveQueue, (req, res) => {
    req.guildQueue.shuffle();
    res.json({ ok: true });
  });

  app.post('/api/guild/:guildId/stop', requireAuth, resolveQueue, (req, res) => {
    req.guildQueue.destroy();
    client.queue.delete(req.params.guildId);
    res.json({ ok: true });
  });

  app.post('/api/guild/:guildId/loop', requireAuth, resolveQueue, (req, res) => {
    const VALID_MODES = new Set(['track', 'queue', 'off']);
    const { mode } = req.body;
    if (!VALID_MODES.has(mode)) {
      return res.status(400).json({ error: "Mode must be 'track', 'queue', or 'off'" });
    }
    req.guildQueue.loop = mode === 'track';
    req.guildQueue.loopQueue = mode === 'queue';
    res.json({ ok: true, mode });
  });

  // Serve dashboard SPA
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.listen(port, '0.0.0.0', () => {
    logger.info(`Web dashboard running at http://0.0.0.0:${port}`);
    if (!WEB_PASSWORD) {
      logger.warn('WEB_PASSWORD is not set — dashboard is open to anyone on your network. Set it in your .env file.');
    }
  });
}

module.exports = { startWebServer };
