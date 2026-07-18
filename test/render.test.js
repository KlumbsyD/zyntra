const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const copies = {
  'root web/public': require('../web/public/render'),
  'nested zyntra/web/public': require('../zyntra/web/public/render'),
};

function container() {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="c"></div></body>');
  return dom.window.document.getElementById('c');
}

// A payload that would inject a node if the title were ever written as HTML,
// and would break out of a single-quoted inline handler if interpolated there.
const EVIL = `<img src=x onerror="window.__xss=1">');alert(1)//`;

for (const [label, R] of Object.entries(copies)) {
  describe(label, () => {
    test('renderPlaylists shows a hostile title as text, injecting no nodes', () => {
      const c = container();
      R.renderPlaylists(c, [{ key: 'k1', title: EVIL, count: 3 }], () => {});
      assert.equal(c.querySelector('img'), null);
      assert.equal(c.querySelector('script'), null);
      assert.ok(c.querySelector('.chip').textContent.includes(EVIL));
    });

    test('renderPlaylists wires selection via a listener, passing values intact', () => {
      const c = container();
      let picked = null;
      R.renderPlaylists(c, [{ key: 'K', title: EVIL, count: 1 }], (key, title) => {
        picked = { key, title };
      });
      c.querySelector('.chip').click();
      assert.deepEqual(picked, { key: 'K', title: EVIL });
    });

    test('renderSearchResults shows hostile metadata as text, injecting no nodes', () => {
      const c = container();
      let picked = null;
      const track = { title: EVIL, artist: EVIL, album: 'Album', duration: 61 };
      R.renderSearchResults(c, [track], (t) => { picked = t; });
      assert.equal(c.querySelector('img'), null);
      const item = c.querySelector('.result-item');
      assert.ok(item.textContent.includes(EVIL));
      item.click();
      assert.deepEqual(picked, track);
    });

    test('renderQueue shows a hostile title as text, injecting no nodes', () => {
      const c = container();
      R.renderQueue(c, [{ title: EVIL, artist: EVIL, duration: 61 }]);
      assert.equal(c.querySelector('img'), null);
      assert.ok(c.querySelector('.queue-item').textContent.includes(EVIL));
    });
  });
}
