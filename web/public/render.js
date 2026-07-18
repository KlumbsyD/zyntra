// Safe DOM rendering for the dashboard.
//
// Security: all track/playlist metadata originates from Plex and is untrusted.
// We build nodes with the DOM API and set text via textContent, never string
// interpolation into innerHTML or inline on* handlers. Actions are wired with
// addEventListener, so a title containing quotes or HTML can never execute.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ZyntraRender = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function fmtDur(sec) {
    if (!sec) return '?:??';
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function empty(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
  }

  function renderPlaylists(container, playlists, onSelect) {
    const doc = container.ownerDocument;
    empty(container);
    if (!playlists.length) {
      container.appendChild(el(doc, 'span', 'muted-note', 'No playlists found'));
      return;
    }
    for (const p of playlists) {
      const chip = el(doc, 'div', 'chip', p.title + ' (' + p.count + ')');
      chip.addEventListener('click', () => onSelect(p.key, p.title));
      container.appendChild(chip);
    }
  }

  function renderSearchResults(container, results, onSelect) {
    const doc = container.ownerDocument;
    empty(container);
    if (!results.length) {
      container.appendChild(el(doc, 'div', 'muted-note', 'No results found.'));
      return;
    }
    for (const t of results) {
      const item = el(doc, 'div', 'result-item');
      const info = el(doc, 'div');
      info.appendChild(el(doc, 'div', 'result-title', t.title));
      info.appendChild(el(doc, 'div', 'result-meta', t.artist + ' • ' + t.album));
      item.appendChild(info);
      item.appendChild(el(doc, 'span', 'result-dur', fmtDur(t.duration)));
      item.addEventListener('click', () => onSelect(t));
      container.appendChild(item);
    }
  }

  function renderQueue(listEl, tracks) {
    const doc = listEl.ownerDocument;
    empty(listEl);
    if (!tracks.length) {
      listEl.appendChild(el(doc, 'li', 'queue-empty', 'No upcoming tracks'));
      return;
    }
    tracks.slice(0, 30).forEach((t, i) => {
      const li = el(doc, 'li', 'queue-item');
      li.appendChild(el(doc, 'span', 'qi-num', String(i + 1)));
      const info = el(doc, 'div', 'qi-info');
      info.appendChild(el(doc, 'div', 'qi-title', t.title));
      info.appendChild(el(doc, 'div', 'qi-artist', t.artist));
      li.appendChild(info);
      li.appendChild(el(doc, 'span', 'qi-dur', fmtDur(t.duration)));
      listEl.appendChild(li);
    });
  }

  return { renderPlaylists, renderSearchResults, renderQueue, fmtDur };
});
