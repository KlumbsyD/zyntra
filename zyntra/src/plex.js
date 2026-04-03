const axios = require('axios');
const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');

class PlexClient {
  constructor() {
    this.authMethod = process.env.PLEX_AUTH_METHOD || 'token'; // 'token' | 'oauth' | 'path'
    this.baseUrl = process.env.PLEX_URL || 'http://localhost:32400';
    this.token = process.env.PLEX_TOKEN || '';
    this.musicPath = process.env.PLEX_MUSIC_PATH || '/music';
    this.oauthToken = null;
  }

  getAuthHeaders() {
    const token = this.authMethod === 'oauth' ? this.oauthToken : this.token;
    return {
      'X-Plex-Token': token,
      'X-Plex-Client-Identifier': 'plex-discord-bot',
      'X-Plex-Product': 'Plex Discord Bot',
      'X-Plex-Version': '1.0.0',
      'Accept': 'application/json',
    };
  }

  async setOAuthToken(token) {
    this.oauthToken = token;
  }

  async testConnection() {
    if (this.authMethod === 'path') {
      return fs.existsSync(this.musicPath);
    }
    try {
      const res = await axios.get(`${this.baseUrl}/identity`, {
        headers: this.getAuthHeaders(),
        timeout: 5000,
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async getMusicLibraries() {
    if (this.authMethod === 'path') return [{ key: 'path', title: 'Local Music' }];
    const res = await axios.get(`${this.baseUrl}/library/sections`, {
      headers: this.getAuthHeaders(),
    });
    return (res.data.MediaContainer.Directory || []).filter(d => d.type === 'artist');
  }

  async search(query, libraryKey) {
    if (this.authMethod === 'path') {
      return this._searchLocalPath(query);
    }
    const sectionKey = libraryKey || await this._getFirstMusicLibraryKey();

    // Parse query for "artist - title" or "title artist" patterns
    const dashIndex = query.indexOf(' - ');
    let titleHint = query.toLowerCase();
    let artistHint = '';
    if (dashIndex !== -1) {
      artistHint = query.slice(0, dashIndex).toLowerCase().trim();
      titleHint = query.slice(dashIndex + 3).toLowerCase().trim();
    }

    // Step 1: Search tracks by title
    const searchTerm = dashIndex !== -1 ? titleHint : query;
    const trackRes = await axios.get(`${this.baseUrl}/library/sections/${sectionKey}/search`, {
      headers: this.getAuthHeaders(),
      params: { query: searchTerm, type: 10 },
    });
    const tracks = trackRes.data.MediaContainer.Metadata || [];

    if (tracks.length) {
      const formatted = tracks.map(t => this._formatTrack(t));

      // Score results to prefer better matches
      const scored = formatted.map(t => {
        const titleLower = t.title.toLowerCase();
        const artistLower = t.artist.toLowerCase();
        const albumLower = t.album.toLowerCase();
        let score = 0;

        // Exact title match is best
        if (titleLower === titleHint) score += 100;
        else if (titleLower.includes(titleHint)) score += 50;

        // Artist match when "artist - title" format used
        if (artistHint) {
          if (artistLower === artistHint) score += 80;
          else if (artistLower.includes(artistHint)) score += 40;
        }

        // Penalise live/remix/acoustic versions unless explicitly searched
        const queryLower = query.toLowerCase();
        const isVariant = /(live|remix|acoustic|demo|instrumental|remaster|cover|edit|version)/i.test(titleLower + ' ' + albumLower);
        const wantsVariant = /(live|remix|acoustic|demo|instrumental|remaster|cover|edit|version)/i.test(queryLower);
        if (isVariant && !wantsVariant) score -= 60;

        return { track: t, score };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.map(s => s.track);
    }

    // Step 2: No track title matches — try searching by artist name
    const artistRes = await axios.get(`${this.baseUrl}/library/sections/${sectionKey}/search`, {
      headers: this.getAuthHeaders(),
      params: { query, type: 8 }, // type 8 = artists
    });
    const artists = artistRes.data.MediaContainer.Metadata || [];
    if (!artists.length) return [];

    // Get all albums for the artist
    const artistKey = artists[0].key;
    const artistTracksRes = await axios.get(`${this.baseUrl}${artistKey}`, {
      headers: this.getAuthHeaders(),
    });
    const albums = artistTracksRes.data.MediaContainer.Metadata || [];
    if (!albums.length) return [];

    // Fetch tracks from ALL albums and combine them
    const allTracks = [];
    for (const album of albums) {
      const albumTracksRes = await axios.get(`${this.baseUrl}${album.key}`, {
        headers: this.getAuthHeaders(),
      });
      const tracks = albumTracksRes.data.MediaContainer.Metadata || [];
      allTracks.push(...tracks.map(t => this._formatTrack(t)));
    }

    // Shuffle so queuing an artist doesn't always play albums in order
    for (let i = allTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]];
    }
    return allTracks;
  }

  /**
   * Returns true if the query matches an artist name in Plex but has no tracks.
   * Used to detect "artist exists in Lidarr but not yet downloaded" scenario.
   */
  async artistExistsInPlex(query, libraryKey) {
    if (this.authMethod === 'path') return false;
    const sectionKey = libraryKey || await this._getFirstMusicLibraryKey();
    const res = await axios.get(`${this.baseUrl}/library/sections/${sectionKey}/search`, {
      headers: this.getAuthHeaders(),
      params: { query, type: 8 },
    });
    return (res.data.MediaContainer.Metadata || []).length > 0;
  }

  async getTrackStreamUrl(trackKey) {
    if (this.authMethod === 'path') return trackKey; // trackKey is already a file path
    const res = await axios.get(`${this.baseUrl}${trackKey}`, {
      headers: this.getAuthHeaders(),
    });
    const track = res.data.MediaContainer.Metadata[0];
    const partKey = track.Media[0].Part[0].key;
    const token = this.authMethod === 'oauth' ? this.oauthToken : this.token;
    return `${this.baseUrl}${partKey}?X-Plex-Token=${token}`;
  }

  async getArtistTracks(artistName) {
    if (this.authMethod === 'path') return this._searchLocalPath(artistName);
    const sectionKey = await this._getFirstMusicLibraryKey();
    const res = await axios.get(`${this.baseUrl}/library/sections/${sectionKey}/search`, {
      headers: this.getAuthHeaders(),
      params: { query: artistName, type: 10 },
    });
    return (res.data.MediaContainer.Metadata || []).map(t => this._formatTrack(t));
  }

  async getAlbumTracks(albumName) {
    if (this.authMethod === 'path') return this._searchLocalPath(albumName);
    const sectionKey = await this._getFirstMusicLibraryKey();
    const res = await axios.get(`${this.baseUrl}/library/sections/${sectionKey}/search`, {
      headers: this.getAuthHeaders(),
      params: { query: albumName, type: 9 }, // type 9 = albums
    });
    const albums = res.data.MediaContainer.Metadata || [];
    if (!albums.length) return [];
    // Get tracks from first matching album
    const albumKey = albums[0].key;
    const tracksRes = await axios.get(`${this.baseUrl}${albumKey}`, {
      headers: this.getAuthHeaders(),
    });
    return (tracksRes.data.MediaContainer.Metadata || []).map(t => this._formatTrack(t));
  }

  async getPlaylists() {
    if (this.authMethod === 'path') return [];
    const res = await axios.get(`${this.baseUrl}/playlists`, {
      headers: this.getAuthHeaders(),
      params: { playlistType: 'audio' },
    });
    return (res.data.MediaContainer.Metadata || []).map(p => ({
      key: p.key,
      title: p.title,
      count: p.leafCount,
    }));
  }

  async getPlaylistTracks(playlistKey) {
    // playlistKey from Plex is already in the form /playlists/ID/items
    // so we just fetch it directly without appending /items again
    const res = await axios.get(`${this.baseUrl}${playlistKey}`, {
      headers: this.getAuthHeaders(),
    });
    return (res.data.MediaContainer.Metadata || []).map(t => this._formatTrack(t));
  }

  async getRecentlyAdded(limit = 10) {
    if (this.authMethod === 'path') return [];
    const sectionKey = await this._getFirstMusicLibraryKey();
    const res = await axios.get(`${this.baseUrl}/library/sections/${sectionKey}/recentlyAdded`, {
      headers: this.getAuthHeaders(),
      params: { type: 10, 'X-Plex-Container-Size': limit },
    });
    return (res.data.MediaContainer.Metadata || []).map(t => this._formatTrack(t));
  }

  _formatTrack(t) {
    return {
      key: t.key,
      ratingKey: t.ratingKey,  // Needed for community playlist reactions
      title: t.title,
      artist: t.grandparentTitle || t.originalTitle || 'Unknown Artist',
      album: t.parentTitle || 'Unknown Album',
      duration: t.duration ? Math.floor(t.duration / 1000) : 0,
      // Store only the path — token is added server-side when proxying to avoid leaking it to clients
      thumb: t.thumb || null,
    };
  }

  /**
   * Returns the full authenticated thumb URL for server-side use only (e.g. Discord embeds).
   * Never send this URL to web clients.
   */
  getAuthenticatedThumbUrl(thumbPath) {
    if (!thumbPath) return null;
    const token = this.authMethod === 'oauth' ? this.oauthToken : this.token;
    return `${this.baseUrl}${thumbPath}?X-Plex-Token=${token}`;
  }

  async _getFirstMusicLibraryKey() {
    const libs = await this.getMusicLibraries();
    if (!libs.length) throw new Error('No music libraries found in Plex');
    return libs[0].key;
  }

  _searchLocalPath(query) {
    const results = [];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const file of fs.readdirSync(dir)) {
        const full = path.join(dir, file);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (/\.(mp3|flac|ogg|m4a|wav|aac)$/i.test(file)) {
          if (file.toLowerCase().includes(query.toLowerCase())) {
            results.push({
              key: full,
              title: path.basename(file, path.extname(file)),
              artist: path.basename(path.dirname(full)),
              album: path.basename(path.dirname(path.dirname(full))),
              duration: 0,
              thumb: null,
            });
          }
        }
      }
    };
    walk(this.musicPath);
    return results;
  }

  /**
   * Get the Plex machine identifier (cached after first call).
   */
  async _getMachineId() {
    if (this._machineId) return this._machineId;
    const res = await axios.get(`${this.baseUrl}/identity`, { headers: this.getAuthHeaders() });
    this._machineId = res.data.MediaContainer.machineIdentifier;
    return this._machineId;
  }

  /**
   * Get or create the community playlist for a guild.
   * Stores the ratingKey in the database to avoid repeated Plex lookups.
   * Returns the playlist ratingKey.
   */
  async getOrCreateCommunityPlaylist(guildId, playlistName) {
    const { getCommunityPlaylistRatingKey, setCommunityPlaylistRatingKey } = require('./database');

    // Check if we have a stored ratingKey for this guild
    const storedKey = getCommunityPlaylistRatingKey(guildId);
    if (storedKey) {
      // Verify it still exists in Plex
      try {
        await axios.get(`${this.baseUrl}/playlists/${storedKey}`, { headers: this.getAuthHeaders() });
        return storedKey;
      } catch {
        // Playlist was deleted in Plex — fall through to recreate
      }
    }

    // Search existing playlists by name
    const playlists = await this.getPlaylists();
    const existing = playlists.find(p => p.title === playlistName);
    if (existing) {
      const key = existing.key.match(/\/playlists\/(\d+)/)?.[1];
      if (key) setCommunityPlaylistRatingKey(guildId, key);
      return key;
    }

    // Create new playlist — Plex requires at least one track to create
    const machineId = await this._getMachineId();
    const sectionKey = await this._getFirstMusicLibraryKey();
    const searchRes = await axios.get(`${this.baseUrl}/library/sections/${sectionKey}/all`, {
      headers: this.getAuthHeaders(),
      params: { type: 10, 'X-Plex-Container-Size': 1 },
    });
    const firstTrack = searchRes.data.MediaContainer.Metadata?.[0];
    if (!firstTrack) throw new Error('No tracks found to seed playlist');

    const createRes = await axios.post(`${this.baseUrl}/playlists`, null, {
      headers: this.getAuthHeaders(),
      params: {
        type: 'audio',
        title: playlistName,
        smart: 0,
        uri: `server://${machineId}/com.plexapp.plugins.library/library/metadata/${firstTrack.ratingKey}`,
      },
    });
    const newKey = createRes.data.MediaContainer.Metadata?.[0]?.ratingKey;
    if (!newKey) throw new Error('Failed to create community playlist');
    setCommunityPlaylistRatingKey(guildId, newKey);
    return newKey;
  }

  /**
   * Rename a guild's community playlist in Plex in place.
   */
  async renameCommunityPlaylist(guildId, oldName, newName) {
    const playlistId = await this.getOrCreateCommunityPlaylist(guildId, oldName);
    await axios.put(`${this.baseUrl}/playlists/${playlistId}`, null, {
      headers: this.getAuthHeaders(),
      params: { title: newName },
    });
  }

  /**
   * Add a track to a guild's community playlist.
   * Avoids duplicates by checking existing items first.
   */
  async addTrackToCommunityPlaylist(guildId, trackRatingKey, playlistName) {
    const playlistId = await this.getOrCreateCommunityPlaylist(guildId, playlistName);

    // Check for duplicates
    const itemsRes = await axios.get(`${this.baseUrl}/playlists/${playlistId}/items`, {
      headers: this.getAuthHeaders(),
    });
    const existing = itemsRes.data.MediaContainer.Metadata || [];
    if (existing.some(t => String(t.ratingKey) === String(trackRatingKey))) {
      return { added: false, reason: 'already_in_playlist' };
    }

    const machineId = await this._getMachineId();
    await axios.put(`${this.baseUrl}/playlists/${playlistId}/items`, null, {
      headers: this.getAuthHeaders(),
      params: {
        uri: `server://${machineId}/com.plexapp.plugins.library/library/metadata/${trackRatingKey}`,
      },
    });
    return { added: true };
  }
}

module.exports = new PlexClient();
