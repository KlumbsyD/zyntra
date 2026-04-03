const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');

const STATE_DIR = process.env.STATE_DIR || '/data';
const DB_PATH = path.join(STATE_DIR, 'zyntra.db');

let db = null;

/**
 * Opens (or creates) the SQLite database using better-sqlite3.
 * Called once at startup.
 */
function openDatabase() {
  try {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    const Database = require('better-sqlite3');
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL'); // better concurrent performance
    db.pragma('foreign_keys = ON');
    _migrate();
    logger.info('Database opened at ' + DB_PATH);
  } catch (err) {
    logger.error('Failed to open database:', err);
    db = null;
  }
}

function _migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS play_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id    TEXT    NOT NULL,
      user_id     TEXT    NOT NULL,
      username    TEXT    NOT NULL,
      track_key   TEXT    NOT NULL,
      title       TEXT    NOT NULL,
      artist      TEXT    NOT NULL DEFAULT 'Unknown Artist',
      album       TEXT    NOT NULL DEFAULT 'Unknown Album',
      duration    INTEGER NOT NULL DEFAULT 0,
      played_at   INTEGER NOT NULL  -- Unix timestamp ms
    );

    CREATE INDEX IF NOT EXISTS idx_ph_guild    ON play_history(guild_id);
    CREATE INDEX IF NOT EXISTS idx_ph_user     ON play_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_ph_played   ON play_history(played_at);
    CREATE INDEX IF NOT EXISTS idx_ph_guild_user ON play_history(guild_id, user_id);
  `);
}

/**
 * Record a track play.
 * @param {object} opts
 * @param {string} opts.guildId
 * @param {string} opts.userId      - Discord user ID of requester
 * @param {string} opts.username    - Discord display name
 * @param {object} opts.track       - track object from plex
 */
function recordPlay({ guildId, userId, username, track }) {
  if (!db) return;
  try {
    db.prepare(`
      INSERT INTO play_history (guild_id, user_id, username, track_key, title, artist, album, duration, played_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      guildId,
      userId,
      username,
      track.key,
      track.title,
      track.artist,
      track.album,
      track.duration || 0,
      Date.now()
    );
  } catch (err) {
    logger.error('Failed to record play:', err);
  }
}

// ─── Stats queries ────────────────────────────────────────────────────────────

function _yearRange(year) {
  const start = new Date(year, 0, 1).getTime();
  const end   = new Date(year + 1, 0, 1).getTime();
  return { start, end };
}

/** Total tracks played by a user in a guild this year */
function getUserTotalPlays(guildId, userId, year) {
  if (!db) return 0;
  const { start, end } = _yearRange(year);
  return db.prepare(`
    SELECT COUNT(*) as n FROM play_history
    WHERE guild_id=? AND user_id=? AND played_at>=? AND played_at<?
  `).get(guildId, userId, start, end)?.n || 0;
}

/** Estimated listening time in seconds for a user */
function getUserListeningTime(guildId, userId, year) {
  if (!db) return 0;
  const { start, end } = _yearRange(year);
  return db.prepare(`
    SELECT COALESCE(SUM(duration),0) as total FROM play_history
    WHERE guild_id=? AND user_id=? AND played_at>=? AND played_at<?
  `).get(guildId, userId, start, end)?.total || 0;
}

/** Top N tracks for a user */
function getUserTopTracks(guildId, userId, year, limit = 5) {
  if (!db) return [];
  const { start, end } = _yearRange(year);
  return db.prepare(`
    SELECT title, artist, album, COUNT(*) as plays
    FROM play_history
    WHERE guild_id=? AND user_id=? AND played_at>=? AND played_at<?
    GROUP BY track_key
    ORDER BY plays DESC
    LIMIT ?
  `).all(guildId, userId, start, end, limit);
}

/** Top N artists for a user */
function getUserTopArtists(guildId, userId, year, limit = 5) {
  if (!db) return [];
  const { start, end } = _yearRange(year);
  return db.prepare(`
    SELECT artist, COUNT(*) as plays
    FROM play_history
    WHERE guild_id=? AND user_id=? AND played_at>=? AND played_at<?
    GROUP BY artist
    ORDER BY plays DESC
    LIMIT ?
  `).all(guildId, userId, start, end, limit);
}

/** Convert UTC timestamp to local hour using TIMEZONE env var */
function _localHour(utcMs) {
  const tz = process.env.TIMEZONE || 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', hour12: false,
    }).formatToParts(new Date(utcMs));
    return parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  } catch { return new Date(utcMs).getHours(); }
}

/** Convert UTC timestamp to local month index (0-11) using TIMEZONE env var */
function _localMonth(utcMs) {
  const tz = process.env.TIMEZONE || 'UTC';
  try {
    return parseInt(new Intl.DateTimeFormat('en-US', {
      timeZone: tz, month: 'numeric',
    }).format(new Date(utcMs))) - 1;
  } catch { return new Date(utcMs).getMonth(); }
}

/** Most active month (0-indexed) for a user */
function getUserPeakMonth(guildId, userId, year) {
  if (!db) return null;
  const { start, end } = _yearRange(year);
  const rows = db.prepare(`
    SELECT played_at FROM play_history
    WHERE guild_id=? AND user_id=? AND played_at>=? AND played_at<?
  `).all(guildId, userId, start, end);
  if (!rows.length) return null;
  const counts = Array(12).fill(0);
  for (const r of rows) counts[_localMonth(r.played_at)]++;
  const peak = counts.indexOf(Math.max(...counts));
  return { month: peak, count: counts[peak] };
}

/** Most active hour of day for a user */
function getUserPeakHour(guildId, userId, year) {
  if (!db) return null;
  const { start, end } = _yearRange(year);
  const rows = db.prepare(`
    SELECT played_at FROM play_history
    WHERE guild_id=? AND user_id=? AND played_at>=? AND played_at<?
  `).all(guildId, userId, start, end);
  if (!rows.length) return null;
  const counts = Array(24).fill(0);
  for (const r of rows) counts[_localHour(r.played_at)]++;
  const peak = counts.indexOf(Math.max(...counts));
  return { hour: peak, count: counts[peak] };
}

/** Unique artists count for a user */
function getUserUniqueArtists(guildId, userId, year) {
  if (!db) return 0;
  const { start, end } = _yearRange(year);
  return db.prepare(`
    SELECT COUNT(DISTINCT artist) as n FROM play_history
    WHERE guild_id=? AND user_id=? AND played_at>=? AND played_at<?
  `).get(guildId, userId, start, end)?.n || 0;
}

/** Derive a fun "music personality" label from listening habits */
function getUserPersonality(guildId, userId, year) {
  if (!db) return null;
  const { start, end } = _yearRange(year);

  const total = getUserTotalPlays(guildId, userId, year);
  if (total === 0) return null;

  const uniqueArtists = getUserUniqueArtists(guildId, userId, year);
  const topTrack = getUserTopTracks(guildId, userId, year, 1)[0];
  const topTrackPlays = topTrack?.plays || 0;
  const repeatRatio = topTrackPlays / total;
  const artistVariety = uniqueArtists / total;
  const peakHour = getUserPeakHour(guildId, userId, year);

  const isNightOwl = peakHour && (peakHour.hour >= 22 || peakHour.hour <= 4);
  const isRepeatOffender = repeatRatio > 0.2;
  const isGenreHopper = artistVariety > 0.6;
  const isAlbumLoyalist = artistVariety < 0.15;
  const isDJ = total > 200;

  if (isRepeatOffender && isNightOwl) return { label: '🌙 Midnight Loop', desc: 'Up late, playing the same song on repeat. A mood.' };
  if (isRepeatOffender) return { label: '🔁 Repeat Offender', desc: 'Found a banger and never let go.' };
  if (isNightOwl && isDJ) return { label: '🦉 Night Shift DJ', desc: 'The after-hours curator nobody asked for but everyone needed.' };
  if (isNightOwl) return { label: '🌙 Night Owl', desc: 'Music sounds better after midnight.' };
  if (isGenreHopper) return { label: '🎭 Genre Hopper', desc: 'No loyalty to a single sound. Keeps everyone guessing.' };
  if (isAlbumLoyalist) return { label: '💿 Album Loyalist', desc: 'Finds an artist and goes deep. Respect.' };
  if (isDJ) return { label: '🎧 Main DJ', desc: 'Basically runs the server playlist at this point.' };
  return { label: '🎵 Music Lover', desc: 'Here for the vibes. No further questions.' };
}

// ─── Server-wide stats ────────────────────────────────────────────────────────

function getServerTotalPlays(guildId, year) {
  if (!db) return 0;
  const { start, end } = _yearRange(year);
  return db.prepare(`
    SELECT COUNT(*) as n FROM play_history
    WHERE guild_id=? AND played_at>=? AND played_at<?
  `).get(guildId, start, end)?.n || 0;
}

function getServerTopTracks(guildId, year, limit = 5) {
  if (!db) return [];
  const { start, end } = _yearRange(year);
  return db.prepare(`
    SELECT title, artist, COUNT(*) as plays
    FROM play_history
    WHERE guild_id=? AND played_at>=? AND played_at<?
    GROUP BY track_key
    ORDER BY plays DESC
    LIMIT ?
  `).all(guildId, start, end, limit);
}

function getServerTopArtists(guildId, year, limit = 5) {
  if (!db) return [];
  const { start, end } = _yearRange(year);
  return db.prepare(`
    SELECT artist, COUNT(*) as plays
    FROM play_history
    WHERE guild_id=? AND played_at>=? AND played_at<?
    GROUP BY artist
    ORDER BY plays DESC
    LIMIT ?
  `).all(guildId, start, end, limit);
}

/** Top DJs — users ranked by tracks requested */
function getServerTopDJs(guildId, year, limit = 5) {
  if (!db) return [];
  const { start, end } = _yearRange(year);
  return db.prepare(`
    SELECT user_id, username, COUNT(*) as plays
    FROM play_history
    WHERE guild_id=? AND played_at>=? AND played_at<?
    GROUP BY user_id
    ORDER BY plays DESC
    LIMIT ?
  `).all(guildId, start, end, limit);
}

function getServerPeakMonth(guildId, year) {
  if (!db) return null;
  const { start, end } = _yearRange(year);
  const rows = db.prepare(`
    SELECT played_at FROM play_history
    WHERE guild_id=? AND played_at>=? AND played_at<?
  `).all(guildId, start, end);
  if (!rows.length) return null;
  const counts = Array(12).fill(0);
  for (const r of rows) counts[_localMonth(r.played_at)]++;
  const peak = counts.indexOf(Math.max(...counts));
  return { month: peak, count: counts[peak] };
}

function getServerUniqueUsers(guildId, year) {
  if (!db) return 0;
  const { start, end } = _yearRange(year);
  return db.prepare(`
    SELECT COUNT(DISTINCT user_id) as n FROM play_history
    WHERE guild_id=? AND played_at>=? AND played_at<?
  `).get(guildId, start, end)?.n || 0;
}

/** Ensure community_playlist table exists with ratingKey column */
function _ensureCommunityTable() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS community_playlist (
      guild_id TEXT PRIMARY KEY,
      playlist_name TEXT NOT NULL,
      plex_rating_key TEXT
    )
  `).run();
  // Migrate: add plex_rating_key column if it doesn't exist yet
  try {
    db.prepare('ALTER TABLE community_playlist ADD COLUMN plex_rating_key TEXT').run();
  } catch {}
}

/** Get community playlist name for a guild (defaults to "<Server Name> Community") */
function getCommunityPlaylistName(guildId, guildName) {
  if (!db) return `${guildName} Community`;
  _ensureCommunityTable();
  const row = db.prepare('SELECT playlist_name FROM community_playlist WHERE guild_id=?').get(guildId);
  return row?.playlist_name || `${guildName} Community`;
}

/** Set community playlist name for a guild */
function setCommunityPlaylistName(guildId, name) {
  if (!db) return;
  _ensureCommunityTable();
  db.prepare(`
    INSERT INTO community_playlist (guild_id, playlist_name)
    VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET playlist_name=excluded.playlist_name
  `).run(guildId, name);
}

/** Store the Plex ratingKey for a guild's community playlist */
function setCommunityPlaylistRatingKey(guildId, ratingKey) {
  if (!db) return;
  _ensureCommunityTable();
  db.prepare(`
    INSERT INTO community_playlist (guild_id, playlist_name, plex_rating_key)
    VALUES (?, '', ?)
    ON CONFLICT(guild_id) DO UPDATE SET plex_rating_key=excluded.plex_rating_key
  `).run(guildId, ratingKey);
}

/** Get the stored Plex ratingKey for a guild's community playlist */
function getCommunityPlaylistRatingKey(guildId) {
  if (!db) return null;
  _ensureCommunityTable();
  return db.prepare('SELECT plex_rating_key FROM community_playlist WHERE guild_id=?').get(guildId)?.plex_rating_key || null;
}

/** Reset community playlist for a guild */
function resetCommunityPlaylistName(guildId) {
  if (!db) return;
  db.prepare('DELETE FROM community_playlist WHERE guild_id=?').run(guildId);
}

module.exports = {
  openDatabase,
  recordPlay,
  // User stats
  getUserTotalPlays,
  getUserListeningTime,
  getUserTopTracks,
  getUserTopArtists,
  getUserPeakMonth,
  getUserPeakHour,
  getCommunityPlaylistName,
  setCommunityPlaylistName,
  setCommunityPlaylistRatingKey,
  getCommunityPlaylistRatingKey,
  resetCommunityPlaylistName,
  getUserUniqueArtists,
  getUserPersonality,
  // Server stats
  getServerTotalPlays,
  getServerTopTracks,
  getServerTopArtists,
  getServerTopDJs,
  getServerPeakMonth,
  getServerUniqueUsers,
};
