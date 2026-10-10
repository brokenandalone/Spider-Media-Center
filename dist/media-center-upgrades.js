(() => {
  const IPTV_DEFAULT = 'https://iptv-org.github.io/iptv/index.m3u';

  // Preserve the compiled Kabel AI DJ controller, but route its standard
  // loopback service call through Electron IPC. This avoids Chromium file://
  // CORS/PNA issues and makes the voice audio available to the BCN mixer.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const target = String(args[0]?.url || args[0] || '');
    const options = args[1] || {};
    let url;
    try { url = new URL(target); } catch { }
    const nativeNovaEndpoint = url
      && url.protocol === 'http:'
      && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
      && url.port === '9876'
      && url.pathname === '/dj/prepare';
    if (nativeNovaEndpoint && window.spider?.novaPrepare) {
      if (options.signal?.aborted) throw new DOMException('DJ request aborted', 'AbortError');
      const request = JSON.parse(String(options.body || '{}'));
      const broadcast = window.__spiderPlayerBridge?.getRadioState?.() || {};
      request.context = {
        ...(request.context && typeof request.context === 'object' ? request.context : {}),
        showName: broadcast.active ? String(broadcast.currentShow || broadcast.show || 'BCN Live') : 'BCN Live'
      };
      if (!Number.isFinite(Number(request.secondsRemaining))) {
        const current = request.currentTrack || {};
        request.secondsRemaining = Math.max(0, Number(current.duration || 0) - Number(current.currentTime || 0));
      }
      const result = await window.spider.novaPrepare(request);
      if (options.signal?.aborted) throw new DOMException('DJ request aborted', 'AbortError');
      const now = window.__spiderPlayerBridge?.getAIDJSnapshot?.()?.current;
      if (request.currentTrack?.id && now?.id && request.currentTrack.id !== now.id) {
        throw new Error('Song changed before Nova completed the DJ break');
      }
      window.__spiderLastDjTalkOver = result.talkOver || null;
      return new Response(JSON.stringify(result), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    const response = await nativeFetch(...args);
    try {
      if (target.includes('/dj/prepare')) {
        response.clone().json().then(payload => {
          window.__spiderLastDjTalkOver = payload?.talkOver || null;
        }).catch(() => {});
      }
    } catch { }
    return response;
  };

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

  let noticeTimer;
  window.addEventListener('spider:notice', event => {
    let box = document.getElementById('spider-playback-notice');
    if (!box) { box = el('div', {id: 'spider-playback-notice', role: 'status'}); document.body.append(box); }
    box.textContent = event.detail?.message || '';
    box.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { box.hidden = true; }, 4500);
  });
  window.addEventListener('spider:playback-error', event => {
    const detail = event.detail || {};
    document.getElementById('spider-playback-error')?.remove();
    const status = el('p', {text: detail.error || 'This source could not be decoded.'});
    const box = el('section', {id: 'spider-playback-error', role: 'alert'},
      el('strong', {text: detail.message || 'Playback failed'}), status);
    let unsubscribe;
    const dismiss = el('button', {text: 'Dismiss', onClick: () => { unsubscribe?.(); box.remove(); }});
    if (detail.canPrepare && window.spider?.prepareMovie) {
      box.append(el('p', {text: 'Prepare a separate compatible copy using Ubuntu Studio’s FFmpeg, then play it here. The original is kept. Large movies can take several minutes.'}));
      const cancel = el('button', {text: 'Cancel preparation', onClick: () => window.spider.cancelMoviePreparation()});
      cancel.hidden = true;
      const prepare = el('button', {text: 'Prepare and play here', onClick: async () => {
        prepare.disabled = true; cancel.hidden = false; dismiss.hidden = true;
        status.textContent = 'Preparing movie for embedded playback…';
        unsubscribe = window.spider.onMoviePreparation?.(progress => { status.textContent = `Prepared ${Math.floor(progress.seconds || 0)} seconds of video…`; });
        try {
          if (await playerBridge().prepareMovie(detail.source)) box.remove();
        } catch (error) { status.textContent = error?.message || String(error); }
        finally { unsubscribe?.(); prepare.disabled = false; cancel.hidden = true; dismiss.hidden = false; }
      }});
      box.append(prepare, cancel);
    }
    box.append(dismiss); document.body.append(box);
  });

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

  function nativeEngineNotice() {
    alert('This source will use Spider Media Center\'s embedded native engine when the libVLC-derived core is wired in. External VLC launching has been removed.');
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
      el('div', { className: 'bcn-result-actions' }, play, bcn)
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


  function getLiveRadioState() {
    try {
      const radio = window.__spiderPlayerBridge?.getRadioState?.() || {};
      return {
        ...radio,
        active: radio.active === true
      };
    } catch {
      return { active: false };
    }
  }

  function ensureAutoDjControl() {
    const actions = document.querySelector('.dj-center-actions');
    const dj = window.__spiderAutoDJ;
    const bridge = window.__spiderPlayerBridge;
    if (!actions || !dj || !bridge) return;

    let button = document.getElementById('bcnAutoDjButton');
    if (!button) {
      button = el('button', {
        id: 'bcnAutoDjButton',
        type: 'button',
        className: 'ghost-button'
      });

      button.addEventListener('click', () => {
        try {
          if (dj.isRunning()) {
            dj.stop();
            ensureAutoDjControl();
            return;
          }

          let playlist = dj.listPlaylists().find((item) => item?.tracks?.length);
          if (!playlist) {
            const queue = bridge.getQueueSnapshot?.()?.queue || [];
            if (!queue.length) {
              alert('AutoDJ needs at least one track in the current queue.');
              return;
            }

            playlist = dj.createPlaylist('BCN Auto Queue');
            dj.savePlaylist({
              ...playlist,
              tracks: queue.map((item) => ({
                ...item,
                weight: 1,
                kind: item.kind || 'music'
              }))
            });
          }

          dj.start(playlist.id);
          ensureAutoDjControl();
        } catch (error) {
          alert(`AutoDJ could not start: ${error?.message || error}`);
        }
      });

      actions.insertBefore(button, actions.children[1] || null);
    }

    const desiredLabel = dj.isRunning() ? 'Stop AutoDJ' : 'Start AutoDJ';
    if (button.textContent !== desiredLabel) button.textContent = desiredLabel;
  }

  function syncConnectionCard() {
    const radio = getLiveRadioState();
    const cards = [...document.querySelectorAll('.broadcast-status .status-card')];
    const card = cards.find((node) => node.querySelector('label')?.textContent?.trim().toLowerCase() === 'connection');
    if (!card) return;

    const value = card.querySelector('div');
    const desiredStatus = radio.active ? 'live' : 'offline';
    if (value && value.textContent !== desiredStatus) value.textContent = desiredStatus;
  }

  function wireRadioDiagnostics() {
    const bridge = window.__spiderPlayerBridge;
    if (!bridge || bridge.__bcnRadioDiagnostics || typeof bridge.startRadio !== 'function') return;

    const originalStart = bridge.startRadio.bind(bridge);
    bridge.startRadio = async (...args) => {
      try {
        return await originalStart(...args);
      } catch (error) {
        alert(`BCN could not go live: ${error?.message || error}`);
        throw error;
      }
    };

    bridge.__bcnRadioDiagnostics = true;
  }

  function syncBcnControls() {
    ensureAutoDjControl();
    syncConnectionCard();
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

    const engineStatus = el('span', { className: 'bcn-status', text: 'Spider native engine · integration branch' });

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

    const webUrl = el('input', {
      type: 'url',
      placeholder: 'https://example.com/'
    });
    const openWebsite = el('button', {
      type: 'button',
      className: 'bcn-primary',
      text: 'Open website',
      onclick: async () => {
        const url = String(webUrl.value || '').trim();
        if (!url) return;
        try {
          await window.spider.openWebPage(url);
        } catch (error) {
          alert(error.message);
        }
      }
    });
    const playDirect = el('button', {
      type: 'button',
      className: 'bcn-small-button',
      text: 'Play direct stream',
      onclick: () => {
        const url = String(webUrl.value || '').trim();
        if (!url) return;
        try {
          enqueueNetwork({
            id: `web-stream-${Date.now()}`,
            title: 'Web stream',
            url,
            source: 'network',
            extension: 'STREAM'
          });
        } catch (error) {
          alert(error.message);
        }
      }
    });

    const novaStatus = el('p', { className: 'bcn-muted', text: 'Nova runs through the native Spider OS DJ service.' });
    const refreshNova = async () => {
      novaStatus.textContent = 'Checking Nova on Spider OS…';
      try {
        const result = await window.spider.novaHealth();
        novaStatus.textContent = result?.ok
          ? 'Nova DJ: connected to Spider OS. Enable DJ breaks in Nova DJ Control.'
          : 'Nova DJ: the local service is not ready.';
      } catch {
        novaStatus.textContent = 'Nova DJ: offline. Music and BCN broadcasting remain available.';
      }
    };
    const checkNova = el('button', {
      type: 'button', className: 'bcn-small-button',
      text: 'Check Nova DJ', onclick: refreshNova
    });

    panel.append(
      close,
      el('header', { className: 'bcn-panel-header' },
        el('div', {},
          el('span', { className: 'bcn-eyebrow', text: 'BROKEN CITY NETWORK' }),
          el('h2', { text: 'BCN Media & Relay' })
        ),
        engineStatus
      ),
      el('p', { className: 'bcn-muted', text: 'Search world radio, load IPTV, open web-media sites, and cue permitted direct streams into the BCN broadcast mix.' }),
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
        el('h3', { text: 'Web Media' }),
        el('p', { className: 'bcn-muted', text: 'Use Open website for a normal web page. Use Play direct stream only for an actual audio/video stream URL such as MP3, AAC, HLS/M3U8 or a direct media endpoint. A normal website URL is not itself a media stream.' }),
        el('div', { className: 'bcn-row' }, webUrl, openWebsite, playDirect)
      ),
      el('div', { className: 'bcn-section' },
        el('h3', { text: 'Nova · Native AI DJ' }),
        novaStatus,
        checkNova
      )
    );

    launcher.addEventListener('click', () => {
      panel.classList.toggle('bcn-hidden');
      if (!panel.classList.contains('bcn-hidden')) void refreshNova();
    });
    document.body.append(launcher, panel);

  }

  function ensureTalkToSpiderControl() {
    let button = document.getElementById('talkToSpiderLauncher');
    if (!button) {
      button = el('button', {
        id: 'talkToSpiderLauncher',
        type: 'button',
        text: 'TALK TO SPIDER'
      });

      button.addEventListener('click', () => {
        const voice = document.querySelector('.voice-assistant, [aria-label="Talk to Spider"]');
        if (!voice) {
          alert('Talk to Spider is not ready yet. Give Spider Media Center a moment to finish loading.');
          return;
        }

        const opening = !voice.classList.contains('spider-voice-open');
        voice.classList.toggle('spider-voice-open', opening);
        button.textContent = opening ? 'CLOSE SPIDER VOICE' : 'TALK TO SPIDER';

        if (opening) {
          window.setTimeout(() => voice.querySelector('input')?.focus(), 50);
        }
      });

      document.body.append(button);
    }
  }

  function ensureFloatingAutoDjControl() {
    const internalAutoDj = [...document.querySelectorAll('.dj-center-actions button')]
      .find((node) => /auto\s*dj/i.test(node.textContent || ''));

    let button = document.getElementById('floatingAutoDjButton');

    // The control-center button is the permanent control. Keep the floating
    // button only as a fallback for layouts where that control is unavailable.
    if (internalAutoDj) {
      button?.remove();
      return;
    }

    if (!button) {
      button = el('button', {
        id: 'floatingAutoDjButton',
        type: 'button',
        text: 'START AUTO DJ'
      });

      button.addEventListener('click', () => {
        try {
          const dj = window.__spiderAutoDJ;
          const bridge = window.__spiderPlayerBridge;

          if (!dj || !bridge) {
            alert('AutoDJ is not ready yet. Give Spider Media Center a moment to finish loading.');
            return;
          }

          if (dj.isRunning()) {
            dj.stop();
          } else {
            let playlist = dj.listPlaylists().find((item) => item?.tracks?.length);
            if (!playlist) {
              const queue = bridge.getQueueSnapshot?.()?.queue || [];
              if (!queue.length) {
                alert('AutoDJ needs at least one track in the current queue.');
                return;
              }

              playlist = dj.createPlaylist('BCN Auto Queue');
              dj.savePlaylist({
                ...playlist,
                tracks: queue.map((item) => ({
                  ...item,
                  weight: 1,
                  kind: item.kind || 'music'
                }))
              });
            }

            dj.start(playlist.id);
          }

          button.textContent = dj.isRunning() ? 'STOP AUTO DJ' : 'START AUTO DJ';
        } catch (error) {
          alert(`AutoDJ could not start: ${error?.message || error}`);
        }
      });

      document.body.append(button);
    }

    const dj = window.__spiderAutoDJ;
    const label = dj?.isRunning?.() ? 'STOP AUTO DJ' : 'START AUTO DJ';
    if (button.textContent !== label) button.textContent = label;
  }

  function syncUiPolish() {
    const brand = document.querySelector('.brand h1 span');
    if (brand && brand.textContent !== 'MEDIA CENTER') brand.textContent = 'MEDIA CENTER';

    const version = document.getElementById('versionLabel');
    if (version && version.textContent !== 'v1.0.0') version.textContent = 'v1.0.0';

    try {
      const queue = window.__spiderPlayerBridge?.getQueueSnapshot?.()?.queue || [];
      const count = document.getElementById('libraryCount');
      const label = `${queue.length} track${queue.length === 1 ? '' : 's'}`;
      if (count && count.textContent !== label) count.textContent = label;
    } catch { }
  }

  function lightSync() {
    buildPanel();
    ensureTalkToSpiderControl();
    ensureFloatingAutoDjControl();
    syncConnectionCard();
    syncUiPolish();
  }

  const boot = () => {
    buildPanel();
    replaceBranding(document.getElementById('root'));
    lightSync();

    // Poll instead of observing React DOM mutations. This avoids the
    // feedback-loop that previously produced a black renderer.
    window.setInterval(lightSync, 1000);
    window.setTimeout(() => replaceBranding(document.getElementById('root')), 2500);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
