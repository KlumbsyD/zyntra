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
    const res = await axios.get(`${this.baseUrl}/library/sections/${sectionKey}/search`, {
      headers: this.getAuthHeaders(),
      params: { query, type: 10 }, // type 10 = tracks
    });
    const tracks = res.data.MediaContainer.Metadata || [];
    return tracks.map(t => this._formatTrack(t));
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
    const res = await axios.get(`${this.baseUrl}${playlistKey}/items`, {
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
}

module.exports = new PlexClient();
