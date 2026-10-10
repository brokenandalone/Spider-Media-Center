'use strict';

// BCN programming control desk. A schedule selects spoken Nova show context;
// it NEVER starts a stream or places an unapproved request on air.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_SHOWS = 56;
const MAX_REQUESTS = 40;

function clean(value, limit) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}
function minutes(value) {
  if (typeof value !== 'string' || !TIME.test(value)) throw new Error('Time must use 24-hour HH:MM');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
function validateShow(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid BCN show');
  const day = Number(input.day);
  if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error('Show day must be Sunday through Saturday');
  const start = clean(input.start, 5);
  const end = clean(input.end, 5);
  if (minutes(end) <= minutes(start)) throw new Error('Show must end after it starts; split overnight shows at midnight');
  const name = clean(input.name, 80);
  if (name.length < 2) throw new Error('Give the show a name');
  const tone = clean(input.tone || 'natural', 48) || 'natural';
  return { id: crypto.randomUUID(), day, start, end, name, tone };
}
function matchShow(shows, when) {
  const day = when.getDay();
  const clock = when.getHours() * 60 + when.getMinutes();
  return shows.find(s => s.day === day && clock >= minutes(s.start) && clock < minutes(s.end)) || null;
}
function checkOverlap(shows, next) {
  const start = minutes(next.start), end = minutes(next.end);
  if (shows.some(s => s.day === next.day && start < minutes(s.end) && minutes(s.start) < end)) {
    throw new Error('That time overlaps an existing BCN show');
  }
}
function nextShow(shows, when) {
  let upcoming = null;
  for (const show of shows) {
    for (let offset = 0; offset <= 7; offset++) {
      const start = new Date(when);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() + offset);
      if (start.getDay() !== show.day) continue;
      start.setHours(Number(show.start.slice(0, 2)), Number(show.start.slice(3)), 0, 0);
      if (start <= when) continue;
      if (!upcoming || start < upcoming.start) upcoming = { show, start };
    }
  }
  return upcoming ? { ...upcoming.show, startsAt: upcoming.start.toISOString() } : null;
}

class BcnDesk {
  constructor(options = {}) {
    this.file = options.file || null;
    this.clock = options.clock || (() => new Date());
    this.shows = [];
    this.requests = [];
    this.listenerRequestsEnabled = false; // never arm public intake on app restart
    this.lastShowKey = null;
    this.lastShowName = null;
    if (this.file) this.load();
  }
  load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!saved || saved.version !== 1) return;
      const shows = [];
      for (const raw of Array.isArray(saved.shows) ? saved.shows.slice(0, MAX_SHOWS) : []) {
        const value = validateShow(raw);
        value.id = /^[a-f0-9-]{10,60}$/i.test(String(raw.id)) ? raw.id : value.id;
        checkOverlap(shows, value);
        shows.push(value);
      }
      this.shows = shows;
      this.requests = (Array.isArray(saved.requests) ? saved.requests : []).slice(-MAX_REQUESTS)
        .filter(r => r && typeof r === 'object')
        .map(r => ({
          id: /^[a-f0-9-]{10,60}$/i.test(String(r.id)) ? r.id : crypto.randomUUID(),
          text: clean(r.text, 180),
          source: r.source === 'listener' ? 'listener' : 'operator',
          status: ['pending', 'approved', 'prepared', 'rejected'].includes(r.status) ? r.status : 'pending',
          createdAt: clean(r.createdAt, 40)
        })).filter(r => r.text);
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('BCN desk preferences could not load:', error.message);
    }
  }
  save() {
    if (!this.file) return;
    const folder = path.dirname(this.file);
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    const temporary = this.file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, shows: this.shows, requests: this.requests }, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } finally {
      try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  state() {
    const now = this.clock();
    const current = matchShow(this.shows, now);
    return {
      days: DAYS,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'local system time',
      localTime: now.toLocaleString(),
      currentShow: current ? { ...current } : null,
      upcomingShow: nextShow(this.shows, now),
      shows: this.shows.map(s => ({ ...s })),
      requests: this.requests.map(r => ({ ...r })),
      listenerRequestsEnabled: this.listenerRequestsEnabled,
      liveBroadcastControlledSeparately: true
    };
  }
  addShow(input) {
    if (this.shows.length >= MAX_SHOWS) throw new Error('BCN show schedule is full');
    const show = validateShow(input);
    checkOverlap(this.shows, show);
    this.shows.push(show);
    this.shows.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
    this.save();
    return this.state();
  }
  removeShow(id) {
    const count = this.shows.length;
    this.shows = this.shows.filter(s => s.id !== id);
    if (count === this.shows.length) throw new Error('BCN show was not found');
    this.save();
    return this.state();
  }
  setListenerRequestsEnabled(enabled) {
    this.listenerRequestsEnabled = enabled === true;
    return this.state();
  }
  addListenerRequest(text) {
    if (!this.listenerRequestsEnabled) throw new Error('BCN listener requests are closed');
    return this.addRequest(text, 'listener');
  }
  addRequest(text, source = 'operator') {
    text = clean(text, 180);
    if (text.length < 3) throw new Error('Enter a listener request or dedication');
    if (this.requests.filter(r => r.status === 'pending' || r.status === 'approved').length >= MAX_REQUESTS) {
      throw new Error('BCN request queue is full');
    }
    this.requests.push({ id: crypto.randomUUID(), text, source: source === 'listener' ? 'listener' : 'operator', status: 'pending', createdAt: this.clock().toISOString() });
    this.requests = this.requests.slice(-MAX_REQUESTS);
    this.save();
    return this.state();
  }
  reviewRequest(id, approve) {
    const request = this.requests.find(r => r.id === id);
    if (!request || (request.status !== 'pending' && !(request.status === 'approved' && approve === false))) {
      throw new Error('Only pending or still-approved requests can be reviewed');
    }
    request.status = approve === true ? 'approved' : 'rejected';
    this.save();
    return this.state();
  }
  // The first approved request is available only after the operator approves it.
  // This plan does not mark it as played; generating audio is not proof of airing.
  planBreak(original) {
    const payload = original && typeof original === 'object' && !Array.isArray(original) ? original : {};
    const current = matchShow(this.shows, this.clock());
    const key = current ? current.id : null;
    const explicit = String(payload.type || 'transition') !== 'transition';
    const next = { ...payload, request: { approved: false }, context: { ...(payload.context && typeof payload.context === 'object' && !Array.isArray(payload.context) ? payload.context : {}) } };
    if (current) {
      next.context.showName = current.name;
      next.context.tone = current.tone;
    }
    let requestId = null;
    if (!explicit) {
      if (key !== this.lastShowKey && current) {
        next.type = 'show_intro';
      } else if (!key && this.lastShowKey) {
        next.type = 'show_outro';
        next.context.showName = this.lastShowName || next.context.showName || 'BCN Live';
      } else {
        const approved = this.requests.find(r => r.status === 'approved');
        if (approved) {
          next.type = 'request';
          next.request = { approved: true, approvedRequest: approved.text };
          requestId = approved.id;
        }
      }
    }
    return { payload: next, key, currentName: current?.name || null, requestId };
  }
  stillApproved(plan) {
    if (!plan.requestId) return true;
    return this.requests.some(r => r.id === plan.requestId && r.status === 'approved');
  }
  commitBreak(plan) {
    if (plan.requestId) {
      const record = this.requests.find(r => r.id === plan.requestId);
      if (record && record.status === 'approved') record.status = 'prepared';
    }
    this.lastShowKey = plan.key;
    this.lastShowName = plan.currentName;
    this.save();
  }
}

module.exports = { BcnDesk, DAYS, validateShow, matchShow, nextShow };
