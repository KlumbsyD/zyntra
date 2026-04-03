const axios = require('axios');
const logger = require('./utils/logger');

const LIDARR_URL = process.env.LIDARR_URL || '';
const LIDARR_API_KEY = process.env.LIDARR_API_KEY || '';

function isConfigured() {
  return !!(LIDARR_URL && LIDARR_API_KEY);
}

function headers() {
  return { 'X-Api-Key': LIDARR_API_KEY, 'Content-Type': 'application/json' };
}

/**
 * Search Lidarr's artist database for a name.
 * Returns array of artist candidates from MusicBrainz.
 */
async function searchArtist(name) {
  const res = await axios.get(`${LIDARR_URL}/api/v1/artist/lookup`, {
    headers: headers(),
    params: { term: name },
    timeout: 8000,
  });
  return res.data || [];
}

/**
 * Check if an artist is already monitored in Lidarr.
 * Returns the existing artist object or null.
 */
async function getExistingArtist(foreignArtistId) {
  const res = await axios.get(`${LIDARR_URL}/api/v1/artist`, {
    headers: headers(),
    timeout: 8000,
  });
  const artists = res.data || [];
  return artists.find(a => a.foreignArtistId === foreignArtistId) || null;
}

/**
 * Get Lidarr quality profile ID by name.
 */
async function getQualityProfileId(profileName = 'Any') {
  const res = await axios.get(`${LIDARR_URL}/api/v1/qualityprofile`, {
    headers: headers(),
    timeout: 8000,
  });
  const profiles = res.data || [];
  const match = profiles.find(p => p.name.toLowerCase() === profileName.toLowerCase());
  return match?.id || profiles[0]?.id || 1;
}

/**
 * Get Lidarr metadata profile ID (use first available).
 */
async function getMetadataProfileId() {
  const res = await axios.get(`${LIDARR_URL}/api/v1/metadataprofile`, {
    headers: headers(),
    timeout: 8000,
  });
  const profiles = res.data || [];
  return profiles[0]?.id || 1;
}

/**
 * Add an artist to Lidarr for monitoring and search.
 * Returns { added: true, artist } or { added: false, reason, existing? }
 */
async function addArtist(artistCandidate) {
  try {
    // Check if already in Lidarr
    const existing = await getExistingArtist(artistCandidate.foreignArtistId);
    if (existing) {
      return { added: false, reason: 'already_exists', existing };
    }

    const qualityProfileId  = await getQualityProfileId('Any');
    const metadataProfileId = await getMetadataProfileId();

    const payload = {
      foreignArtistId:  artistCandidate.foreignArtistId,
      artistName:       artistCandidate.artistName,
      qualityProfileId,
      metadataProfileId,
      rootFolderPath:   process.env.LIDARR_ROOT_FOLDER || '/data',
      monitored:        true,
      monitorNewItems:  'all',
      addOptions: {
        monitor:            'all',
        searchForMissingAlbums: true,
      },
      images: artistCandidate.images || [],
      links:  artistCandidate.links  || [],
      genres: artistCandidate.genres || [],
    };

    const res = await axios.post(`${LIDARR_URL}/api/v1/artist`, payload, {
      headers: headers(),
      timeout: 10000,
    });

    return { added: true, artist: res.data };
  } catch (err) {
    const msg = err.response?.data?.[0]?.errorMessage || err.message;
    logger.error('Lidarr addArtist error:', msg);
    throw new Error(msg);
  }
}

module.exports = { isConfigured, searchArtist, getExistingArtist, addArtist };
