(() => {
  const IPTV_DEFAULT = 'https://iptv-org.github.io/iptv/index.m3u';

  const state = {
    iptv: [],
    radio: [],
    rightsConfirmed: false
  };

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([key, value]) => {
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (value !== undefined && value !== null) node.setAttribute(key, value);
    });
    children.flat().filter(Boolean).forEach((child) => node.append(child.nodeType ? child : document.createTextNode(String(child))));
    return node;
  };

  function playerBridge() {
    return window.__spiderPlayerBridge || window.__spiderPlayerEngine || null;
  }

  function enqueueNetwork(item) {
    const bridge = playerBridge();
    if (!bridge || typeof bridge.enqueue !== 'function') {
      throw new Error('Spider playback bridge is not ready yet.');
    }
    return bridge.enqueue({
      id: item.id || `network-${Date.now()}`,
      title: item.title || item.name || 'Network stream',
      artist: item.country || item.language || item.group || 'Network',
      artwork: item.artwork || '',
      source: 'network',
      extension: item.extension || 'STREAM',
      url: item.url
    }, true);
  }

  async function playVlc(item) {
    if (!window.spider?.playWithVlc) throw new Error('VLC integration is not available.');
    return await window.spider.playWithVlc(item.url || item, {});
  }

  function replaceBranding(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const value = node.nodeValue || '';
      let next = value
        .replace(/SPIDER RADIO/g, 'BROKEN CITY NETWORK')
        .replace(/Spider Radio Live/g, 'BCN Live')
        .replace(/Spider Radio/g, 'Broken City Network');
      if (next !== value) node.nodeValue = next;
    }
  }

  function stationCard(item, kind) {
    const title = el('strong', { text: item.name || item.title || 'Untitled stream' });
    const metaParts = [
      item.country,
      item.language,
      item.group,
      item.codec ? `${item.codec}${item.bitrate ? ` · ${item.bitrate} kbps` : ''}` : ''
    ].filter(Boolean);
    const meta = el('span', { className: 'bcn-item-meta', text: metaParts.join(' · ') || kind });

    const play = el('button', {
      type: 'button',
      className: 'bcn-small-button',
      text: 'Play',
      onclick: async () => {
        try {
          enqueueNetwork({ ...item, title: item.title || item.name });
        } catch (error) {
          alert(error.message);
        }
      }
    });

    const vlc = el('button', {
      type: 'button',
      className: 'bcn-small-button',
      text: 'VLC',
      onclick: async () => {
        try {
          await playVlc(item);
        } catch (error) {
          alert(error.message);
        }
      }
    });

    const bcn = el('button', {
      type: 'button',
      className: 'bcn-small-button bcn-accent',
      text: 'Cue to BCN',
      onclick: () => {
        if (!state.rightsConfirmed) {
          alert('Confirm that you have permission to rebroadcast this source before routing it into BCN.');
          return;
        }
        try {
          enqueueNetwork({ ...item, title: item.title || item.name });
          window.dispatchEvent(new CustomEvent('spider:show-panel', { detail: 'radio' }));
        } catch (error) {
          alert(error.message);
        }
      }
    });

    return el('div', { className: 'bcn-result-card' },
      el('div', { className: 'bcn-result-copy' }, title, meta),
      el('div', { className: 'bcn-result-actions' }, play, vlc, bcn)
    );
  }

  function renderList(container, items, kind, filter = '') {
    container.replaceChildren();
    const q = filter.trim().toLowerCase();
    const visible = items
      .filter((item) => !q || JSON.stringify(item).toLowerCase().includes(q))
      .slice(0, 200);

    if (!visible.length) {
      container.append(el('p', { className: 'bcn-muted', text: 'No matching sources.' }));
      return;
    }

    visible.forEach((item) => container.append(stationCard(item, kind)));
  }

  function buildPanel() {
    if (document.getElementById('bcnMediaLauncher')) return;

    const launcher = el('button', {
      id: 'bcnMediaLauncher',
      type: 'button',
      text: 'BCN MEDIA'
    });

    const panel = el('section', { id: 'bcnMediaPanel', className: 'bcn-panel bcn-hidden' });
    const close = el('button', {
      className: 'bcn-close',
      type: 'button',
      text: '×',
      onclick: () => panel.classList.add('bcn-hidden')
    });

    const vlcStatus = el('span', { className: 'bcn-status', text: 'Checking VLC…' });

    const iptvUrl = el('input', { type: 'url', value: IPTV_DEFAULT });
    const iptvSearch = el('input', { type: 'search', placeholder: 'Filter channels…' });
    const iptvResults = el('div', { className: 'bcn-results' });
    iptvSearch.addEventListener('input', () => renderList(iptvResults, state.iptv, 'IPTV', iptvSearch.value));

    const loadIptv = el('button', {
      className: 'bcn-primary',
      type: 'button',
      text: 'Load IPTV playlist',
      onclick: async () => {
        loadIptv.disabled = true;
        loadIptv.textContent = 'Loading…';
        try {
          const result = await window.spider.loadIptvPlaylist(iptvUrl.value || IPTV_DEFAULT);
          state.iptv = Array.isArray(result?.entries) ? result.entries : [];
          renderList(iptvResults, state.iptv, 'IPTV', iptvSearch.value);
          loadIptv.textContent = `Loaded ${state.iptv.length} channels`;
        } catch (error) {
          loadIptv.textContent = 'Load failed';
          alert(error.message);
        } finally {
          loadIptv.disabled = false;
        }
      }
    });

    const country = el('select');
    [
      ['AU', 'Australia'],
      ['GB', 'United Kingdom'],
      ['US', 'United States'],
      ['CA', 'Canada'],
      ['IE', 'Ireland'],
      ['NZ', 'New Zealand']
    ].forEach(([value, label]) => country.append(el('option', { value, text: label })));

    const tags = el('input', { value: 'talk,news,speech', placeholder: 'talk,news,speech' });
    const radioSearch = el('input', { type: 'search', placeholder: 'Filter found stations…' });
    const radioResults = el('div', { className: 'bcn-results' });
    radioSearch.addEventListener('input', () => renderList(radioResults, state.radio, 'Radio', radioSearch.value));

    const findRadio = el('button', {
      className: 'bcn-primary',
      type: 'button',
      text: 'Find talk radio',
      onclick: async () => {
        findRadio.disabled = true;
        findRadio.textContent = 'Searching…';
        try {
          state.radio = await window.spider.searchRadioDirectory({
            countrycode: country.value,
            tags: tags.value.split(',').map((v) => v.trim()).filter(Boolean),
            limit: 80
          });
          renderList(radioResults, state.radio, 'Radio', radioSearch.value);
          findRadio.textContent = `Found ${state.radio.length} stations`;
        } catch (error) {
          findRadio.textContent = 'Search failed';
          alert(error.message);
        } finally {
          findRadio.disabled = false;
        }
      }
    });

    const rights = el('input', { type: 'checkbox' });
    rights.addEventListener('change', () => { state.rightsConfirmed = rights.checked; });

    const youtubeUrl = el('input', {
      type: 'url',
      placeholder: 'https://www.youtube.com/watch?v=…'
    });
    const youtubeVlc = el('button', {
      type: 'button',
      className: 'bcn-primary',
      text: 'Open YouTube URL in VLC',
      onclick: async () => {
        try {
          await playVlc(youtubeUrl.value);
        } catch (error) {
          alert(error.message);
        }
      }
    });

    const djStatus = el('p', { className: 'bcn-muted', text: 'Portable AI DJ: not scanned' });
    const scanDj = el('button', {
      type: 'button',
      className: 'bcn-small-button',
      text: 'Scan USB DJ',
      onclick: async () => {
        try {
          const info = await window.spider.portableDjInfo();
          djStatus.textContent = info?.available
            ? `Portable AI DJ found: ${info.directory}`
            : 'Portable AI DJ drive not found.';
        } catch (error) {
          djStatus.textContent = error.message;
        }
      }
    });

    panel.append(
      close,
      el('header', { className: 'bcn-panel-header' },
        el('div', {},
          el('span', { className: 'bcn-eyebrow', text: 'BROKEN CITY NETWORK' }),
          el('h2', { text: 'BCN Media & Relay' })
        ),
        vlcStatus
      ),
      el('p', { className: 'bcn-muted', text: 'Search world radio, load IPTV, use VLC compatibility, and cue permitted sources into the BCN broadcast mix.' }),
      el('div', { className: 'bcn-rights' },
        rights,
        el('span', { text: ' I have permission to rebroadcast sources I cue into BCN.' })
      ),
      el('div', { className: 'bcn-section' },
        el('h3', { text: 'International Radio' }),
        el('div', { className: 'bcn-row' }, country, tags, findRadio),
        radioSearch,
        radioResults
      ),
      el('div', { className: 'bcn-section' },
        el('h3', { text: 'Live TV / IPTV' }),
        el('div', { className: 'bcn-row' }, iptvUrl, loadIptv),
        iptvSearch,
        iptvResults
      ),
      el('div', { className: 'bcn-section' },
        el('h3', { text: 'YouTube via VLC' }),
        el('p', { className: 'bcn-muted', text: 'Pass a normal YouTube URL to VLC when VLC can resolve it. Spider does not implement DRM, paywall or ad-circumvention code.' }),
        el('div', { className: 'bcn-row' }, youtubeUrl, youtubeVlc)
      ),
      el('div', { className: 'bcn-section' },
        el('h3', { text: 'Portable AI DJ' }),
        djStatus,
        scanDj,
        el('p', { className: 'bcn-muted', text: 'A valid drive contains SPIDER_DJ/spider-dj.json. The portable service can later use a bundled GGUF or Spider OS Ollama.' })
      )
    );

    launcher.addEventListener('click', () => panel.classList.toggle('bcn-hidden'));
    document.body.append(launcher, panel);

    window.spider?.vlcInfo?.().then((info) => {
      vlcStatus.textContent = info?.available
        ? `VLC ready · ${info.version || info.path}`
        : 'VLC not found';
    }).catch(() => { vlcStatus.textContent = 'VLC not found'; });
  }

  const boot = () => {
    buildPanel();
    replaceBranding(document.getElementById('root'));
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  const observer = new MutationObserver(() => {
    buildPanel();
    replaceBranding(document.getElementById('root'));
  });

  const root = document.getElementById('root');
  if (root) observer.observe(root, { subtree: true, childList: true, characterData: true });
})();
