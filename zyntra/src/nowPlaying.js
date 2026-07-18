// Builds the "Now Playing" Discord embed.
//
// Security: this embed is posted to a Discord channel, whose message object
// (including any embed image/thumbnail URL) is readable by everyone in the
// channel. It therefore must never contain an authenticated Plex thumbnail
// URL, which carries the Plex token as a query parameter. We omit the
// thumbnail entirely — with a LAN Plex server Discord's image proxy can't
// reach it anyway.

function formatDuration(seconds) {
  if (!seconds) return 'Unknown';
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

function buildNowPlayingEmbed(track, footerText) {
  return {
    color: 0xe5a00d,
    title: 'Now Playing',
    description: '**' + track.title + '**',
    fields: [
      { name: 'Artist', value: track.artist, inline: true },
      { name: 'Album', value: track.album, inline: true },
      { name: 'Duration', value: formatDuration(track.duration), inline: true },
    ],
    footer: { text: footerText },
  };
}

module.exports = { buildNowPlayingEmbed, formatDuration };
