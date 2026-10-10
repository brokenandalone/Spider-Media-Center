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

    // Session-only continuity guard. Never auto-publish, relaunch a public
    // tunnel, play unqueued media or bypass the operator's rights confirmation.
    let continuityArmed = false;
    let continuityPausedAt = 0;
    let continuityAttempts = 0;
    let continuityHealthyAt = 0;
    const continuityRights = el('input', { type: 'checkbox', 'aria-label': 'Confirm BCN broadcast rights for queued music' });
    const continuityStatus = el('p', {
      className: 'bcn-muted',
      text: 'Disarmed. Start BCN and AutoDJ manually, then arm continuity.'
    });
    const continuityButton = el('button', {
      type: 'button', className: 'bcn-small-button', text: 'Arm continuity',
      onclick: () => {
        if (continuityArmed) {
          disarmContinuity('Disarmed by operator.');
          return;
        }
        const bridge = window.__spiderPlayerBridge;
        const dj = window.__spiderAutoDJ;
        if (!continuityRights.checked) {
          continuityStatus.textContent = 'Confirm broadcast rights for your queued content first.';
          return;
        }
        if (!bridge?.getRadioState?.()?.active || !dj?.isRunning?.()) {
          continuityStatus.textContent = 'Start BCN broadcasting and AutoDJ before arming.';
          return;
        }
        const eligible = bridge.getBroadcastRecoveryState?.()?.fallbackCount || 0;
        if (eligible < 2 || !bridge.triggerBroadcastRecovery) {
          continuityStatus.textContent = 'Continuity requires at least two playable, authorized queued tracks.';
          return;
        }
        bridge.setBroadcastRecovery?.({ enabled: true, silenceThresholdMs: 8000 });
        continuityArmed = true;
        continuityPausedAt = 0;
        continuityAttempts = 0;
        continuityHealthyAt = Date.now();
        continuityButton.textContent = 'Disarm continuity';
        continuityStatus.textContent = 'Armed for this app session. BCN must remain live. Automatic playback recovery is enabled.';
      }
    });
    function disarmContinuity(reason) {
      continuityArmed = false;
      continuityPausedAt = 0;
      continuityAttempts = 0;
      continuityButton.textContent = 'Arm continuity';
      continuityStatus.textContent = reason || 'Continuity disarmed.';
    }
    const checkContinuity = () => {
      if (!continuityArmed) return;
      const bridge = window.__spiderPlayerBridge;
      if (!bridge?.getRadioState?.()?.active) {
        disarmContinuity('BCN went off air. Continuity was disarmed; public broadcasting was not restarted.');
        return;
      }
      if (!continuityRights.checked || !window.__spiderAutoDJ?.isRunning?.()) {
        disarmContinuity('Rights confirmation or AutoDJ was turned off. Continuity was disarmed.');
        return;
      }
      const fallback = bridge.getBroadcastRecoveryState?.()?.fallbackCount || 0;
      if (fallback < 2) {
        disarmContinuity('Too few playable tracks remain. Continuity was disarmed.');
        return;
      }
      const player = bridge.getAIDJSnapshot?.() || {};
      const dj = bridge.getAIDJConfig?.() || {};
      if (dj.pendingBreak || dj.liveBreakActive) {
        continuityPausedAt = 0;
        return;
      }
      if (!player.paused && player.current) {
        continuityPausedAt = 0;
        if (Date.now() - continuityHealthyAt >= 30000) {
          continuityAttempts = 0;
          continuityHealthyAt = Date.now();
        }
        continuityStatus.textContent = 'Guard armed. Music is playing; BCN is under continuity supervision.';
        return;
      }
      if (!continuityPausedAt) continuityPausedAt = Date.now();
      if (Date.now() - continuityPausedAt < 15000) {
        continuityStatus.textContent = 'Playback paused. Continuity checking for persistent dead air…';
        return;
      }
      continuityPausedAt = Date.now();
      if (++continuityAttempts > 3) {
        disarmContinuity('Three unsuccessful recovery attempts. Operator attention required.');
        return;
      }
      try {
        const started = bridge.triggerBroadcastRecovery();
        continuityStatus.textContent = started
          ? 'Attempting queued-track recovery (' + continuityAttempts + '/3).'
          : 'Unable to find another playable track (' + continuityAttempts + '/3).';
      } catch {
        continuityStatus.textContent = 'Recovery error (' + continuityAttempts + '/3).';
      }
    };

    const signalStatus = el('p', {
      className: 'bcn-muted',
      role: 'status',
      text: 'Signal monitor not checked. ON AIR only means the relay was opened.'
    });
    const signalCounters = el('p', {
      className: 'bcn-muted',
      text: 'No listener delivery has been verified.'
    });
    let signalChecking = false;
    const refreshSignal = async () => {
      if (signalChecking || !window.spider?.radioDiagnostics) return;
      signalChecking = true;
      try {
        const signal = await window.spider.radioDiagnostics();
        recoveryState = signal.recovery || null;
        restoreRelay.hidden = !recoveryState?.lost;
        restoreRelay.disabled = !recoveryState?.available;
        if (recoveryState?.lost) {
          restoreStatus.textContent = recoveryState.reason + ' ' +
            (recoveryState.attemptsRemaining === 0
              ? 'Recovery limit reached. Start a new manual broadcast.'
              : recoveryState.retryAfterSeconds > 0
                ? 'Retry available in ' + recoveryState.retryAfterSeconds + ' seconds.'
                : 'Confirm rights, then restore the relay. The link will change.');
        }
        const descriptions = {
          off_air: 'OFF AIR. No public radio stream is running.',
          relay_not_ready: 'Relay starting or unavailable. No verified public stream.',
          no_listeners: 'Relay connected. No listeners; delivered audio cannot be verified.',
          waiting_for_first_audio: 'Listener connected. Waiting for the first encoded audio chunks.',
          sending: 'Audio chunks are reaching connected listener sockets.',
          stalled: 'WARNING: One or more listener streams have stopped receiving audio chunks.'
        };
        signalStatus.textContent = descriptions[signal.status] || 'Unknown radio delivery condition.';
        signalCounters.textContent = signal.connectedListeners + ' connected · ' +
          signal.flowingListeners + ' receiving chunks · ' +
          signal.stalledListeners + ' stalled · ' +
          signal.chunksWritten + ' chunks delivered · ' +
          signal.slowDisconnects + ' slow clients disconnected';
        if (continuityArmed && recoveryState?.lost) {
          disarmContinuity('The public relay dropped. Continuity is disarmed until the operator restores BCN.');
        }
        if (continuityArmed && signal.status === 'stalled') {
          disarmContinuity('Listener delivery stalled. Continuity disarmed; check the radio encoder and relay before rearming.');
        }
      } catch (error) {
        signalStatus.textContent = 'Signal monitor unavailable. Audio delivery cannot be verified: ' +
          (error?.message || String(error));
      } finally {
        signalChecking = false;
      }
    };
    const checkSignal = el('button', {
      type: 'button', className: 'bcn-small-button', text: 'Check radio signal',
      onclick: refreshSignal
    });
    // A manually approved restoration ONLY after the previous public tunnel
    // exited unexpectedly. Every recovery rotates the public listener URL.
    const restoreRights = el('input', {
      type: 'checkbox', 'aria-label': 'Confirm broadcast permissions for relay recovery'
    });
    const restoreStatus = el('p', {
      className: 'bcn-muted',
      text: 'No relay recovery is needed. Manual broadcast controls remain available.'
    });
    let recoveryState = null;
    const restoreRelay = el('button', {
      type: 'button', className: 'bcn-small-button', text: 'Restore BCN relay', hidden: '',
      onclick: async () => {
        if (!restoreRights.checked) {
          restoreStatus.textContent = 'Confirm you still have permission to broadcast this queued content.';
          return;
        }
        if (!recoveryState?.available) {
          restoreStatus.textContent = 'Recovery is unavailable. Check the signal and retry cooldown.';
          return;
        }
        restoreRelay.disabled = true;
        restoreStatus.textContent = 'Creating a new public relay. The previous listener link will expire…';
        try {
          const result = await window.spider.radioRecover();
          if (result?.active !== true || !result?.publicUrl) throw new Error('The new public relay did not confirm an active link.');
          restoreRights.checked = false;
          restoreStatus.textContent = 'BCN relay restored. IMPORTANT: Share the NEW listener link or QR code. The previous URL is invalid.';
          // Engine receives a radio:live event and updates the existing
          // broadcast player; do not start a second broadcaster.
          await refreshSignal();
        } catch (error) {
          restoreStatus.textContent = 'Relay restoration failed: ' + (error?.message || String(error));
          await refreshSignal();
        } finally {
          restoreRelay.disabled = false;
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

    // All scheduling and approvals live in the main process, not localStorage.
    // Scheduling changes Nova's spoken context but NEVER launches broadcasting.
    const showStatus = el('p', { className: 'bcn-muted', text: 'Show schedule uses Spider OS local time.' });
    const showList = el('div', { className: 'bcn-results' });
    const requestStatus = el('p', { className: 'bcn-muted', text: 'Only approved entries can be spoken by Nova.' });
    let listenerIntakeEnabled = false;
    const listenerIntakeButton = el('button', {
      type: 'button', className: 'bcn-small-button',
      text: 'Open listener submissions',
      onclick: async () => {
        listenerIntakeButton.disabled = true;
        try {
          const result = await window.spider.bcnSetListenerIntake(!listenerIntakeEnabled);
          renderProgramming(result);
        } catch (error) {
          requestStatus.textContent = error?.message || String(error);
        } finally { listenerIntakeButton.disabled = false; }
      }
    });
    const requestList = el('div', { className: 'bcn-results' });

    const showDay = el('select');
    ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      .forEach((name, index) => showDay.append(el('option', { value: String(index), text: name })));
    showDay.value = String(new Date().getDay());
    const showStart = el('input', { type: 'time', value: '18:00', 'aria-label': 'Show starts' });
    const showEnd = el('input', { type: 'time', value: '19:00', 'aria-label': 'Show ends' });
    const showName = el('input', { type: 'text', maxlength: '80', placeholder: 'Show name', 'aria-label': 'Show name' });
    const showTone = el('select', { 'aria-label': 'Nova show tone' });
    ['natural', 'late night', 'haunting', 'energetic', 'relaxed'].forEach(tone =>
      showTone.append(el('option', { value: tone, text: tone })));
    const requestText = el('input', {
      type: 'text', maxlength: '180',
      placeholder: 'Enter a request or dedication for review',
      'aria-label': 'Request for operator approval'
    });

    const renderProgramming = snapshot => {
      const current = snapshot.currentShow;
      const next = snapshot.upcomingShow;
      listenerIntakeEnabled = snapshot.listenerRequestsEnabled === true;
      listenerIntakeButton.textContent = listenerIntakeEnabled
        ? 'Close listener submissions' : 'Open listener submissions';
      showStatus.textContent = current
        ? 'Scheduled now: ' + current.name + '. Time zone: ' + snapshot.timeZone
        : 'No scheduled show is active. Next: ' +
          (next ? next.name + ' (' + snapshot.days[next.day] + ' ' + next.start + ')' : 'nothing scheduled') +
          '. Time zone: ' + snapshot.timeZone;
      showList.replaceChildren();
      if (!snapshot.shows.length) showList.append(el('p', { className: 'bcn-muted', text: 'No shows scheduled yet.' }));
      snapshot.shows.forEach(show => {
        const remove = el('button', {
          type: 'button', className: 'bcn-small-button', text: 'Remove',
          onclick: async () => {
            remove.disabled = true;
            try { renderProgramming(await window.spider.bcnRemoveShow(show.id)); }
            catch (error) { showStatus.textContent = error?.message || String(error); }
            finally { remove.disabled = false; }
          }
        });
        showList.append(el('div', { className: 'bcn-result-card' },
          el('span', { text: snapshot.days[show.day] + ' · ' + show.start + ' to ' + show.end + ' · ' + show.name + ' (' + show.tone + ')' }),
          remove));
      });

      requestList.replaceChildren();
      if (!snapshot.requests.length) requestList.append(el('p', {
        className: 'bcn-muted', text: 'No requests in the operator queue.'
      }));
      snapshot.requests.slice().reverse().forEach(request => {
        const actions = el('div', { className: 'bcn-result-actions' });
        if (request.status === 'pending' || request.status === 'approved') {
          for (const approved of request.status === 'pending' ? [true, false] : [false]) {
            const control = el('button', {
              type: 'button', className: 'bcn-small-button',
              text: approved ? 'Approve' : request.status === 'approved' ? 'Withdraw' : 'Reject',
              onclick: async () => {
                control.disabled = true;
                try { renderProgramming(await window.spider.bcnReviewRequest(request.id, approved)); }
                catch (error) { requestStatus.textContent = error?.message || String(error); }
                finally { control.disabled = false; }
              }
            });
            actions.append(control);
          }
        }
        requestList.append(el('div', { className: 'bcn-result-card' },
          el('span', { text: request.text + ' · ' + request.status + ' · ' + (request.source === 'listener' ? 'listener submission' : 'operator entry') }),
          actions));
      });
      requestStatus.textContent = (listenerIntakeEnabled ? 'Listener submissions open. ' : 'Listener submissions closed. ') + 'Pending requires approval. Prepared is not confirmed airtime.';
    };
    const refreshProgramming = async () => {
      try { renderProgramming(await window.spider.bcnDeskState()); }
      catch (error) { showStatus.textContent = 'BCN desk unavailable: ' + (error?.message || String(error)); }
    };
    const addShowButton = el('button', {
      type: 'button', className: 'bcn-small-button', text: 'Schedule show',
      onclick: async () => {
        addShowButton.disabled = true;
        try {
          renderProgramming(await window.spider.bcnAddShow({
            day: Number(showDay.value), start: showStart.value, end: showEnd.value,
            name: showName.value, tone: showTone.value
          }));
          showName.value = '';
        } catch (error) { showStatus.textContent = error?.message || String(error); }
        finally { addShowButton.disabled = false; }
      }
    });
    const addRequestButton = el('button', {
      type: 'button', className: 'bcn-small-button', text: 'Add for review',
      onclick: async () => {
        addRequestButton.disabled = true;
        try {
          renderProgramming(await window.spider.bcnAddRequest(requestText.value));
          requestText.value = '';
        } catch (error) { requestStatus.textContent = error?.message || String(error); }
        finally { addRequestButton.disabled = false; }
      }
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
        el('h3', { text: 'BCN Signal Monitor' }),
        el('p', { className: 'bcn-muted',
          text: 'Distinguishes a public relay from data delivery to listener sockets. Connected audio is not proof of playback or audibility on the listener device.' }),
        signalStatus,
        signalCounters,
        checkSignal,
        el('div', { className: 'bcn-section' },
          el('h3', { text: 'Operator Relay Recovery' }),
          el('p', { className: 'bcn-muted',
            text: 'Available only when a public relay unexpectedly disconnects. This is never automatic. Temporary Cloudflare links rotate after recovery, so listeners must use the new URL.' }),
          el('label', { className: 'bcn-row' }, restoreRights,
            el('span', { text: 'I confirm I still have broadcast rights for the queued content.' })),
          restoreStatus,
          restoreRelay
        )
      ),
      el('div', { className: 'bcn-section' },
        el('h3', { text: 'Nova · Native AI DJ' }),
        novaStatus,
        checkNova
      ),
      el('div', { className: 'bcn-section' },
        el('h3', { text: 'BCN Continuity Guard' }),
        el('p', { className: 'bcn-muted',
          text: 'Optional session-only recovery for an already-live BCN broadcast and running AutoDJ. Never starts a broadcast or chooses new music. Paused playback may be resumed from your existing queue after 15 seconds.' }),
        el('label', { className: 'bcn-row' }, continuityRights,
          el('span', { text: 'I have broadcasting rights for the queued material.' })),
        continuityStatus,
        continuityButton
      ),
      el('div', { className: 'bcn-section' },
        el('h3', { text: 'BCN Show Clock' }),
        el('p', { className: 'bcn-muted', text: 'Set Nova’s on-air show identity by Spider OS local time. Scheduling announcements does not start or stop a public broadcast. Split overnight blocks at midnight.' }),
        showStatus,
        el('div', { className: 'bcn-row' }, showDay, showStart, showEnd, showName, showTone, addShowButton),
        showList
      ),
      el('div', { className: 'bcn-section' },
        el('h3', { text: 'BCN Request Desk' }),
        el('div', { className: 'bcn-row' }, listenerIntakeButton),
        el('p', { className: 'bcn-muted', text: 'Operator-entered requests only. Future listener-submission integration will require explicit moderation; nothing is announced until you approve it.' }),
        requestStatus,
        el('div', { className: 'bcn-row' }, requestText, addRequestButton),
        requestList
      )
    );

    launcher.addEventListener('click', () => {
      panel.classList.toggle('bcn-hidden');
      if (!panel.classList.contains('bcn-hidden')) { void refreshNova(); void refreshProgramming(); void refreshSignal(); }
    });
    if (window.spider?.onRadioEvent) {
      window.spider.onRadioEvent(event => {
        if (event?.type === 'relay-lost') {
          restoreRights.checked = false;
          disarmContinuity('Public relay lost. Operator recovery required.');
          void refreshSignal();
        }
        if (event?.type === 'relay-restored') {
          restoreRights.checked = false;
          void refreshSignal();
        }
        if (event?.type === 'stopped') disarmContinuity('BCN stopped. Continuity was disarmed.');
        if (event?.type === 'stopped') void refreshSignal();
        if (event?.type === 'bcn-listener-request' || event?.type === 'stopped') {
          void refreshProgramming();
        }
      });
    }
    window.setInterval(() => {
      checkContinuity();
      if (continuityArmed || !panel.classList.contains('bcn-hidden')) void refreshSignal();
    }, 5000);
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
