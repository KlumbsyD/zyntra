const express = require('express');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const plex = require('../src/plex');
const logger = require('../src/utils/logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidSnowflake(s) {
  return typeof s === 'string' && /^\d{17,20}$/.test(s);
}

function serverError(res, label) {
  logger.error(`API error: ${label}`);
  res.status(500).json({ error: 'Internal server error' });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

const WEB_PASSWORD = process.env.WEB_PASSWORD || '';
const sessions = new Map(); // token -> expiresAt

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + 24 * 60 * 60 * 1000);
  return token;
}

function validateSession(token) {
  if (!token || !sessions.has(token)) return false;
  if (sessions.get(token) < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// Middleware: protects API routes — returns 401 JSON if not authed
function requireAuth(req, res, next) {
  if (!WEB_PASSWORD) return next();
  const token = req.headers['x-session-token'];
  if (validateSession(token)) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// Middleware: protects page routes — redirects to /login if not authed
function requireAuthPage(req, res, next) {
  if (!WEB_PASSWORD) return next();
  const token = req.cookies?.zyntra_token;
  if (validateSession(token)) return next();
  return res.redirect('/login');
}

// ─── Rate limiters ────────────────────────────────────────────────────────────

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Server ───────────────────────────────────────────────────────────────────

function startWebServer(client) {
  const app = express();
  const port = process.env.WEB_PORT || 3333;

  // No helmet — running on local LAN over HTTP, security headers cause HSTS issues

  app.use(express.json({ limit: '16kb' }));
  app.use(require('cookie-parser')());
  app.use('/api/', apiLimiter);

  // ── Login page ─────────────────────────────────────────────────────────────
  app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  });

  // ── Login API ──────────────────────────────────────────────────────────────
  app.post('/api/login', loginLimiter, (req, res) => {
    if (!WEB_PASSWORD) return res.json({ ok: true });

    const { password } = req.body;
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Missing password' });
    }

    const expected = Buffer.from(WEB_PASSWORD);
    const given = Buffer.from(password.slice(0, 256));
    const match = expected.length === given.length &&
      crypto.timingSafeEqual(expected, given);

    if (!match) return res.status(403).json({ error: 'Incorrect password' });

    const token = createSession();
    // Set cookie for page auth + return token for API auth
    res.cookie('zyntra_token', token, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'strict',
    });
    res.json({ ok: true, token });
  });

  // ── Static files (login page assets) ──────────────────────────────────────
  app.use(express.static(path.join(__dirname, 'public')));

  // ── Protected API routes ───────────────────────────────────────────────────
  app.get('/api/status', requireAuth, (req, res) => {
    try {
      const guilds = [];
      for (const [guildId, q] of client.queue.entries()) {
        const guild = client.guilds.cache.get(guildId);
        const status = q.getStatus();
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
      res.json({ connected: ok, method: plex.authMethod });
    } catch (err) {
      serverError(res, err.message);
    }
  });

  app.get('/api/search', requireAuth, searchLimiter, async (req, res) => {
    try {
      const q = req.query.q;
      if (!q || typeof q !== 'string') return res.json([]);
      const results = await plex.search(q.slice(0, 200));
      const safe = results.slice(0, 20).map(({ thumb, ...rest }) => rest);
      res.json(safe);
    } catch (err) {
      serverError(res, err.message);
    }
  });

  app.get('/api/playlists', requireAuth, async (req, res) => {
    try {
      res.json(await plex.getPlaylists());
    } catch (err) {
      serverError(res, err.message);
    }
  });

  app.get('/api/recently-added', requireAuth, async (req, res) => {
    try {
      const tracks = await plex.getRecentlyAdded(20);
      res.json(tracks.map(({ thumb, ...rest }) => rest));
    } catch (err) {
      serverError(res, err.message);
    }
  });

  function resolveQueue(req, res, next) {
    if (!isValidSnowflake(req.params.guildId)) {
      return res.status(400).json({ error: 'Invalid guild ID' });
    }
    const q = client.queue.get(req.params.guildId);
    if (!q) return res.status(404).json({ error: 'No active queue' });
    req.guildQueue = q;
    next();
  }

  app.post('/api/guild/:guildId/skip', requireAuth, resolveQueue, (req, res) => {
    req.guildQueue.skip(); res.json({ ok: true });
  });
  app.post('/api/guild/:guildId/pause', requireAuth, resolveQueue, (req, res) => {
    req.guildQueue.pause(); res.json({ ok: true });
  });
  app.post('/api/guild/:guildId/resume', requireAuth, resolveQueue, (req, res) => {
    req.guildQueue.resume(); res.json({ ok: true });
  });
  app.post('/api/guild/:guildId/volume', requireAuth, resolveQueue, (req, res) => {
    const vol = Number(req.body.volume);
    if (!Number.isFinite(vol) || vol < 0 || vol > 100) {
      return res.status(400).json({ error: 'Volume must be 0–100' });
    }
    req.guildQueue.setVolume(vol / 100);
    res.json({ ok: true, volume: vol });
  });
  app.post('/api/guild/:guildId/shuffle', requireAuth, resolveQueue, (req, res) => {
    req.guildQueue.shuffle(); res.json({ ok: true });
  });
  app.post('/api/guild/:guildId/stop', requireAuth, resolveQueue, (req, res) => {
    req.guildQueue.destroy();
    client.queue.delete(req.params.guildId);
    res.json({ ok: true });
  });
  app.post('/api/guild/:guildId/loop', requireAuth, resolveQueue, (req, res) => {
    const VALID = new Set(['track', 'queue', 'off']);
    const { mode } = req.body;
    if (!VALID.has(mode)) return res.status(400).json({ error: 'Invalid mode' });
    req.guildQueue.loop = mode === 'track';
    req.guildQueue.loopQueue = mode === 'queue';
    res.json({ ok: true, mode });
  });

  // ── Dashboard (protected page) ─────────────────────────────────────────────
  app.get('*', requireAuthPage, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.listen(port, '0.0.0.0', () => {
    logger.info(`Web dashboard running at http://0.0.0.0:${port}`);
    if (!WEB_PASSWORD) {
      logger.warn('WEB_PASSWORD is not set — dashboard is unprotected.');
    }
  });
}

module.exports = { startWebServer };
