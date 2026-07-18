const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Both copies build the "Now Playing" embed; guard both.
const copies = {
  'root src': require('../src/nowPlaying'),
  'nested zyntra/src': require('../zyntra/src/nowPlaying'),
};

const track = {
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  duration: 125,
  thumb: '/library/metadata/42/thumb/1',
};

for (const [label, { buildNowPlayingEmbed }] of Object.entries(copies)) {
  describe(label, () => {
    test('never embeds the Plex token in the now-playing embed', () => {
      const embed = buildNowPlayingEmbed(track, 'Queue: 3 track(s) remaining');
      assert.equal(/X-Plex-Token/i.test(JSON.stringify(embed)), false);
      assert.equal(embed.thumbnail, undefined);
    });

    test('shows title, artist, album and formatted duration', () => {
      const embed = buildNowPlayingEmbed(track, 'the footer');
      assert.match(embed.description, /Song/);
      assert.deepEqual(embed.fields.map(f => f.value), ['Artist', 'Album', '2:05']);
      assert.equal(embed.footer.text, 'the footer');
    });
  });
}
