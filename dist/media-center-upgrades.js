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
        voiceProfile: (()=>{try{return localStorage.getItem('spider.nova.voice.profile.v1')||'auto';}catch{return 'auto';}})(),
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
      window.dispatchEvent(new CustomEvent('spider:nova-voice-used',{
        detail:{engine:result.voiceEngine||'unverified',
          requested:result.voiceProfileRequested||request.context.voiceProfile,
          fallback:result.voiceFallback===true}
      }));
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

  // Session-only cue rotation: never writes or publishes a playlist.
  const CUE_ID='bcn-live-cue-session';
  const UNKNOWN_BCN_SETTING='spider.bcn.allowUnknownArtist.v1';
  const allowUnknownBcn=()=>{
    try{return localStorage.getItem(UNKNOWN_BCN_SETTING)!=='off';}
    catch{return true;}
  };
  const setUnknownBcn=enabled=>{
    try{localStorage.setItem(UNKNOWN_BCN_SETTING,enabled?'on':'off');}catch{}
    window.dispatchEvent(new Event('spider:bcn-unknown-change'));
  };
  function cueEligibleTracks(bridge) {
    const isBcn=window.SpiderPlaylistWorkshopCore?.isBcnArtist;
    return (bridge?.getQueueSnapshot?.()?.queue||[]).filter(t=>
      t?.url && t?.kind!=='commercial' && t?.kind!=='shoutout' &&
      typeof isBcn==='function' && isBcn(t.artist,{allowUnknown:allowUnknownBcn()}) &&
      !/\.(mp4|mkv|avi|mov|webm|wmv)(?:[?#]|$)/i.test(t.url));
  }
  function startCueAutoDJ(dj,bridge) {
    if(!dj||!bridge)throw Error('AutoDJ is not ready.');
    const tracks=cueEligibleTracks(bridge);
    if(!tracks.length)throw Error('No BCN music in the cue. Queue music by Broken Sorrow, Therapy and Sonz, Justin Therapy, or J-Cold, or enable temporary Unknown Artist support for untagged tracks.');
    // The session cue must never enter saved playlist persistence, even when
    // a user creates another playlist while AutoDJ is running.
    const cue=dj.__bcnCueSession||(dj.__bcnCueSession={
      id:CUE_ID,name:'BCN Live Cue (session only)',tracks:[]
    });
    cue.tracks=tracks.map(t=>({...t,weight:1,kind:'music'}));
    if(!dj.__bcnCueGuardInstalled){
      const pick=dj._selectNextFromPlaylist.bind(dj);
      const fallback=dj._selectFallbackTrack.bind(dj);
      dj._selectNextFromPlaylist=function(playlist=this.currentPlaylist){
        if(playlist?.id!==CUE_ID)return pick(playlist);
        const all=cueEligibleTracks(window.__spiderPlayerBridge);
        if(!all.length)return null;
        const recent=new Set((this.recentTracks||[]).map(item=>item.key));
        let options=all.filter(item=>!recent.has(item.url||item.id));
        if(!options.length)options=all;
        const last=(this.recentTracks||[]).slice(0,2).map(item=>item.artist);
        const varied=options.filter(item=>!last.includes(String(item.artist||'').trim().toLowerCase()));
        if(varied.length)options=varied;
        return options[Math.floor(Math.random()*options.length)];
      };
      dj._selectFallbackTrack=function(){
        if(this.currentPlaylist?.id===CUE_ID)return null;
        return fallback();
      };
      dj.__bcnCueGuardInstalled=true;
    }
    dj.playlists.push(cue);
    try { dj.start(CUE_ID); }
    finally {
      const at=dj.playlists.indexOf(cue);
      if(at>=0)dj.playlists.splice(at,1);
    }
    if(!dj.__bcnCueRefresh){
      dj.__bcnCueRefresh=window.setInterval(()=>{
        if(!dj.isRunning?.()||dj.currentPlaylist?.id!==CUE_ID)return;
        const next=cueEligibleTracks(window.__spiderPlayerBridge);
        cue.tracks=next.map(t=>({...t,weight:1,kind:'music'}));dj.currentPlaylist=cue;
      },3000);
    }
    return tracks.length;
  }
  function installCueClickHandler(){
    if(window.__bcnCueClickInstalled)return;
    window.__bcnCueClickInstalled=true;
    document.addEventListener('click',event=>{
      const button=event.target?.closest?.('.dj-center-actions button');
      const dj=window.__spiderAutoDJ;
      if(!button||!/auto\s*dj/i.test(button.textContent||'')||!dj||dj.isRunning?.())return;
      try {
        startCueAutoDJ(dj,window.__spiderPlayerBridge);
        event.preventDefault();
        event.stopImmediatePropagation();
      } catch(error){
        event.preventDefault();
        event.stopImmediatePropagation();
        alert(error?.message||String(error));
      }
    },true);
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

          startCueAutoDJ(dj,bridge);
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

  // Queue cleanup controls live outside React's own DOM tree.
  // Editing React-rendered "Up next" nodes directly can break reconciliation.
  function queueAction(mode) {
    const bridge = window.__spiderPlayerBridge || window.__spiderPlayerEngine;
    if (!bridge?.getQueueSnapshot) {
      window.dispatchEvent(new CustomEvent('spider:notice',{detail:{message:'The music queue is not ready yet.'}}));
      return;
    }
    const snapshot = bridge.getQueueSnapshot();
    const all = snapshot.queue?.length || 0;
    if (!all && !window.__spiderAutoDJ?.isRunning?.()) {
      window.dispatchEvent(new CustomEvent('spider:notice',{detail:{message:'The upcoming queue is already empty.'}}));
      return;
    }
    const live = bridge.getRadioState?.()?.active === true;
    if (mode === 'all' && live) {
      window.dispatchEvent(new CustomEvent('spider:notice',{detail:{message:'Stop the BCN broadcast before clearing the currently playing song.'}}));
      return;
    }
    if (live && !window.confirm('BCN is ON AIR. This will stop AutoDJ and remove queued tracks, leaving the current song playing until it ends. Continue?')) return;
    const api = mode === 'all' ? 'clearQueue'
      : mode === 'empty' ? 'removeEmptyQueueRows' : 'clearUpcomingQueue';
    try {
      if (typeof bridge[api] !== 'function') throw Error('Queue cleanup needs the updated Media Center playback engine.');
      const result=bridge[api]();
      const message=result?.ok === false ? (result.reason||result.error||'Queue cleanup blocked')
        : (result?.removed||0)+' queued track'+(result?.removed===1?'':'s')+' removed. '+
          (result?.keptCurrent ? 'Now playing stays on.' : 'The queue is empty.')+
          ' AutoDJ was stopped; saved playlists and music files were preserved.';
      window.dispatchEvent(new CustomEvent('spider:notice',{detail:{message}}));
      document.getElementById('bcnQueueStatus')?.replaceChildren(document.createTextNode(message));
    } catch(error) {
      window.dispatchEvent(new CustomEvent('spider:notice',{detail:{message:error?.message||String(error)}}));
    }
  }
  function ensureQueueControls(){
    let toolbar=document.getElementById('spiderQueueToolbar');
    if(toolbar)return;
    toolbar=el('div',{id:'spiderQueueToolbar',role:'group','aria-label':'Upcoming music queue controls'},
      el('button',{type:'button',id:'spiderClearUpcoming',text:'CLEAR UP NEXT',
        title:'Keep now playing, remove all other queued tracks and stop AutoDJ',
        onclick:()=>queueAction('upcoming')}),
      el('button',{type:'button',id:'spiderPruneBlank',text:'REMOVE BLANK ROWS',
        title:'Remove queue entries with no playable file URL',
        onclick:()=>queueAction('empty')})
    );
    document.body.append(toolbar);
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
    const queueStatus = el('p',{id:'bcnQueueStatus',className:'bcn-muted',
      text:'Clear Up Next keeps the current song and stops AutoDJ. Remove Blank Rows clears queue placeholders with no audio URL. Clear All requires BCN to be off air.'});

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
    const publicRelayStatus = el('p', { className: 'bcn-muted',
      text: 'External reachability is not checked yet.' });
    let signalChecking = false;
    const refreshSignal = async () => {
      if (signalChecking || !window.spider?.radioDiagnostics) return;
      signalChecking = true;
      try {
        const signal = await window.spider.radioDiagnostics();
        const reach = signal.publicRelay || {};
        const labels = {
          off_air: 'OFF AIR. No public URL is being checked.',
          checking: 'Checking the station from the public internet. Three consecutive failures are required before an outage warning.',
          reachable: 'Public station page is reachable from Spider OS.',
          degraded: 'WARNING: The public station page has failed three consecutive checks. The tunnel process may still be running.'
        };
        publicRelayStatus.textContent = (labels[reach.status] || 'Relay reachability unknown.') +
          (reach.lastSuccessAt ? ' Last successful check: ' + new Date(reach.lastSuccessAt).toLocaleTimeString() + '.' : '') +
          ' Remote page checks do not verify audible audio.';
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
        if (continuityArmed && reach.status === 'degraded') {
          disarmContinuity('Public station could not be reached. Continuity disarmed pending operator diagnosis.');
        }
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
          restoreRelay.disabled = !recoveryState?.available;
        }
      }
    });


    const bcnUnknownToggle=el('input',{type:'checkbox',id:'bcnAllowUnknownArtist','aria-label':'Temporarily allow Unknown Artist music on BCN'});
    bcnUnknownToggle.checked=allowUnknownBcn();
    bcnUnknownToggle.addEventListener('change',()=>setUnknownBcn(bcnUnknownToggle.checked));
    window.addEventListener('spider:bcn-unknown-change',()=>{
      bcnUnknownToggle.checked=allowUnknownBcn();
    });

    const novaStatus = el('p', { className: 'bcn-muted', text: 'Nova runs through the native Spider OS DJ service.' });
    const novaVoice=el('select',{id:'bcnNovaVoice', 'aria-label':'Nova voice profile'});
    const novaVoices=[
      ['auto','Automatic: Natasha / Matilda backup'],['natasha','Natasha (online)'],
      ['matilda','Matilda (Piper offline)'],['kirra','Kirra (Piper offline)'],
      ['bindi','Bindi (Piper offline)'],['marlo','Marlo (Piper offline)'],
      ['tully','Tully (Piper offline)'],['willow','Willow (Piper offline)']
    ];
    for(const [id,label] of novaVoices)novaVoice.append(el('option',{value:id,text:label}));
    try{novaVoice.value=localStorage.getItem('spider.nova.voice.profile.v1')||'auto';}catch{novaVoice.value='auto';}
    novaVoice.addEventListener('change',()=>{
      try{localStorage.setItem('spider.nova.voice.profile.v1',novaVoice.value);}catch{}
      novaStatus.textContent='Nova voice set to '+novaVoice.options[novaVoice.selectedIndex].text+'. Changes apply to the next DJ break.';
    });
    const novaVoiceAvailability=el('p',{className:'bcn-muted',text:'Voice availability is checked through the native Nova service.'});
    const novaRealVoice=el('p',{className:'bcn-muted',text:'Last on-air neural voice: not verified yet. No robotic fallback is permitted in the new native Nova service.'});
    window.addEventListener('spider:nova-voice-used',event=>{
      const item=event.detail||{};
      novaRealVoice.textContent='Last Nova break: '+String(item.engine||'unknown')+
        (item.fallback?' (fallback from '+String(item.requested||'selected voice')+')':'')+
        '. This confirms what produced the audio, not merely the selected option.';
    });
    const refreshNovaVoices=async()=>{
      try{
        const result=await window.spider.novaVoices();
        novaVoiceAvailability.textContent=result.piperReady
          ?'Webbie Australian Piper model found. Available profiles: '+result.voices.join(', ')+'.'
          :'Australian Piper model is missing or not executable for this user. Check Webbie voice installation. Natasha may work online.';
        novaRealVoice.textContent=result.lastVoice?.error
          ?'Neural synthesis failed: '+result.lastVoice.error+'. Music continues; robot voice is not used.'
          :'Last voice: '+(result.lastVoice?.engine||'none yet')+
            (result.lastVoice?.usedFallback?' (used neural fallback)':'')+
            (result.robotVoiceAllowed?' WARNING: old Nova service still allows robotic backup.':' · robotic fallback disabled.');
      }catch{
        novaVoiceAvailability.textContent='Could not query native Nova voices. Confirm the paired Nova update is installed and service is running.';
      }
    };
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
    const programStatus = el('p',{className:'bcn-muted',text:'Generated shows saved in Playlist Workshop appear here before you schedule a day and time.'});
    const programList = el('div',{className:'bcn-results'});
    const selectedProgram = el('select',{'aria-label':'Generated BCN show playlist'});
    selectedProgram.append(el('option',{value:'',text:'Manual spoken show (no playlist linked)'}));
    selectedProgram.addEventListener('change',()=>{
      const chosen=selectedProgram.options[selectedProgram.selectedIndex];
      if(chosen?.dataset?.name)showName.value=chosen.dataset.name;
    });
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
      const programs=Array.isArray(snapshot.programs)?snapshot.programs:[];
      const preferred=selectedProgram.value;
      selectedProgram.replaceChildren(el('option',{value:'',text:'Manual spoken show (no playlist linked)'}));
      programList.replaceChildren();
      if(!programs.length)programList.append(el('p',{className:'bcn-muted',text:'No generated shows registered. Open Playlist Workshop, generate a show, then select Save show to BCN Scheduler.'}));
      programs.forEach(program=>{
        const option=el('option',{value:program.id,text:program.name+' · '+program.trackCount+' songs'});
        option.dataset.name=program.name;
        selectedProgram.append(option);
        const scheduled=(program.scheduledBlocks||[]).length;
        const remove=el('button',{className:'bcn-small-button',type:'button',text:'Remove draft',onclick:async()=>{
          if(scheduled)return;
          if(!window.confirm('Remove this show from BCN programming? The music playlist remains in AutoDJ.'))return;
          try{renderProgramming(await window.spider.bcnRemoveProgram(program.id));}
          catch(e){programStatus.textContent=e?.message||String(e);}
        }});
        remove.disabled=Boolean(scheduled);
        const play=el('button',{className:'bcn-small-button',type:'button',text:'Start playlist manually',onclick:()=>{
          try{
            const dj=window.__spiderAutoDJ;
            if(!dj?.start)throw Error('AutoDJ is not ready.');
            const saved=dj.listPlaylists().find(p=>String(p.id)===program.playlistId);
            if(!saved?.tracks?.length)throw Error('The show playlist is missing or empty. Open Playlist Workshop to repair it.');
            if(!window.confirm('Start AutoDJ using '+program.name+'? This does not start a public BCN broadcast.'))return;
            dj.start(saved.id);
            programStatus.textContent='AutoDJ armed for '+program.name+'. Public broadcast state unchanged.';
          }catch(e){programStatus.textContent=e?.message||String(e);}
        }});
        programList.append(el('div',{className:'bcn-result-card'},
          el('span',{text:program.name+' · '+program.trackCount+' tracks · '+program.durationMinutes+' min · '+
            (scheduled?scheduled+' scheduled block(s)':'NOT SCHEDULED')}),el('div',{className:'bcn-result-actions'},play,remove)));
      });
      if([...selectedProgram.options].some(o=>o.value===preferred))selectedProgram.value=preferred;
      programStatus.textContent=programs.length+' generated BCN show(s). Scheduling changes Nova show identity only; it does not automatically start music or broadcasting.';
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
    window.addEventListener('spider:bcn-program-changed',refreshProgramming);
    const addShowButton = el('button', {
      type: 'button', className: 'bcn-small-button', text: 'Schedule show',
      onclick: async () => {
        addShowButton.disabled = true;
        try {
          renderProgramming(await window.spider.bcnAddShow({
            day: Number(showDay.value), start: showStart.value, end: showEnd.value,
            name: showName.value, tone: showTone.value,
            programId:selectedProgram.value || undefined
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
        publicRelayStatus,
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
      el('div',{className:'bcn-section'},
        el('h3',{text:'Up Next · Queue Cleanup'}),
        queueStatus,
        el('div',{className:'bcn-row'},
          el('button',{className:'bcn-primary',type:'button',text:'Clear upcoming (keep playing)',onclick:()=>queueAction('upcoming')}),
          el('button',{className:'bcn-small-button',type:'button',text:'Remove blank queue rows',onclick:()=>queueAction('empty')}),
          el('button',{className:'bcn-small-button',type:'button',text:'Clear entire queue (stops music)',onclick:()=>{
            if(window.confirm('Stop the playing track and empty the entire cue? Audio files and your saved playlists will not be deleted.'))queueAction('all');
          }})
        )
      ),
      el('div', { className: 'bcn-section' },
        el('h3', { text: 'Nova · Native AI DJ' }),
        el('label',{className:'bcn-row'},bcnUnknownToggle,
          el('span',{text:'Temporarily allow Unknown Artist / untagged songs in BCN cue and show generator'})),
        el('p',{className:'bcn-muted',
          text:'Only use this until your music tags are corrected. Unknown Artist can represent any song, so review the cue and confirm broadcast rights. Other named artists stay excluded.'}),
        novaStatus,
        el('div',{className:'bcn-row'},novaVoice,checkNova),
        novaVoiceAvailability,
        novaRealVoice,
        el('button',{type:'button',className:'bcn-small-button',text:'Check actual voice engine',onclick:refreshNovaVoices})
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
        programStatus,
        programList,
        el('div',{className:'bcn-row'},selectedProgram),
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
        if (event?.type === 'relay-degraded') {
          if (continuityArmed) disarmContinuity('Public relay is unreachable. Operator diagnosis required.');
          void refreshSignal();
        }
        if (event?.type === 'relay-reachable') void refreshSignal();
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
            startCueAutoDJ(dj,bridge);
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
    installCueClickHandler();
    ensureQueueControls();
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
