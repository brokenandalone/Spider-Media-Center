'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BcnDesk, matchShow, nextShow, validateShow } = require('../electron/bcn-desk.cjs');

function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bcn-desk-'));
  let date = new Date(2026, 9, 11, 17, 30); // Sunday, Spider OS local time
  const file = path.join(root, 'config', 'bcn-desk.json');
  const desk = new BcnDesk({ file, clock: () => date });
  const advance = (hour, minute) => { date = new Date(2026, 9, 11, hour, minute); };
  try { return fn({ desk, file, advance, clock: () => date }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('show scheduler validates local weekday blocks and rejects overlaps', () => fixture(({ desk }) => {
  assert.throws(() => validateShow({ day: 7, start: '18:00', end: '19:00', name: 'Nightwatch' }), /day/);
  assert.throws(() => validateShow({ day: 0, start: '18:00', end: '17:00', name: 'Nightwatch' }), /after/);
  assert.throws(() => validateShow({ day: 0, start: '18:00', end: '01:00', name: 'Nightwatch' }), /midnight/);
  const current = desk.addShow({ day: 0, start: '18:00', end: '19:00', name: 'BCN Nightwatch', tone: 'haunting' });
  assert.equal(current.shows.length, 1);
  assert.equal(current.upcomingShow.name, 'BCN Nightwatch');
  assert.throws(() => desk.addShow({ day: 0, start: '18:30', end: '19:30', name: 'Overlap' }), /overlaps/);
  const second = desk.addShow({ day: 0, start: '19:00', end: '20:00', name: 'BCN Late Night' });
  assert.equal(second.shows.length, 2);
  desk.removeShow(second.shows[1].id);
  assert.equal(desk.state().shows.length, 1);
}));

test('show clock picks the current block and next occurrence, never starts a broadcast', () => fixture(({ desk, advance, clock }) => {
  desk.addShow({ day: 0, start: '18:00', end: '19:00', name: 'BCN Nightwatch' });
  advance(18, 0);
  assert.equal(desk.state().currentShow.name, 'BCN Nightwatch');
  assert.equal(matchShow(desk.state().shows, clock()).name, 'BCN Nightwatch');
  advance(19, 0);
  assert.equal(desk.state().currentShow, null);
  assert.ok(nextShow(desk.state().shows, clock()).startsAt);
  assert.equal(desk.state().liveBroadcastControlledSeparately, true);
}));

test('scheduled show intro happens once and show outro follows on the next break', () => fixture(({ desk, advance }) => {
  desk.addShow({ day: 0, start: '18:00', end: '19:00', name: 'BCN Nightwatch', tone: 'haunting' });
  advance(18, 5);
  let plan = desk.planBreak({ type: 'transition', context: { station: 'Broken City Network' } });
  assert.equal(plan.payload.type, 'show_intro');
  assert.equal(plan.payload.context.showName, 'BCN Nightwatch');
  assert.equal(plan.payload.context.tone, 'haunting');
  desk.commitBreak(plan);
  plan = desk.planBreak({ type: 'transition' });
  assert.equal(plan.payload.type, 'transition');
  desk.commitBreak(plan);
  advance(19, 1);
  plan = desk.planBreak({ type: 'transition' });
  assert.equal(plan.payload.type, 'show_outro');
  assert.equal(plan.payload.context.showName, 'BCN Nightwatch');
  desk.commitBreak(plan);
  assert.equal(desk.planBreak({ type: 'transition' }).payload.type, 'transition');
}));

test('pending requests never reach Nova without approval and cannot bypass review', () => fixture(({ desk }) => {
  const saved = desk.addRequest('Neon Graves for a listener');
  const id = saved.requests[0].id;
  let plan = desk.planBreak({
    type: 'transition',
    request: { approved: true, approvedRequest: 'Fake request never reviewed' }
  });
  assert.equal(plan.payload.request.approved, false);
  assert.equal(plan.payload.type, 'transition');
  desk.reviewRequest(id, true);
  plan = desk.planBreak({ type: 'transition' });
  assert.equal(plan.payload.type, 'request');
  assert.equal(plan.payload.request.approved, true);
  assert.equal(plan.payload.request.approvedRequest, 'Neon Graves for a listener');
  assert.equal(desk.stillApproved(plan), true);
  desk.reviewRequest(id, false);
  assert.equal(desk.stillApproved(plan), false);
  assert.equal(desk.planBreak({ type: 'transition' }).payload.type, 'transition');
}));

test('successful preparation records request as prepared, not proven broadcast', () => fixture(({ desk }) => {
  const id = desk.addRequest('Play The River Remembers').requests[0].id;
  desk.reviewRequest(id, true);
  const plan = desk.planBreak({ type: 'transition' });
  desk.commitBreak(plan);
  assert.equal(desk.state().requests[0].status, 'prepared');
  assert.equal(desk.planBreak({ type: 'transition' }).payload.type, 'transition');
  assert.throws(() => desk.reviewRequest(id, true), /Only pending or still-approved/);
}));

test('BCN schedule and review queue survive a restart with private file permissions', () => fixture(({ desk, file, clock }) => {
  desk.addShow({ day: 0, start: '21:00', end: '22:00', name: 'Overpass Hour' });
  const id = desk.addRequest('A song for the night shift').requests[0].id;
  desk.reviewRequest(id, true);
  const restored = new BcnDesk({ file, clock });
  assert.equal(restored.state().shows[0].name, 'Overpass Hour');
  assert.equal(restored.state().requests[0].status, 'approved');
  assert.equal(restored.state().requests[0].id, id);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
}));

test('BCN remains an internal operator desk, not an open request API', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'dist', 'media-center-upgrades.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.match(renderer, /BCN Show Clock/);
  assert.match(renderer, /BCN Request Desk/);
  assert.match(renderer, /bcnReviewRequest/);
  assert.match(preload, /bcnDeskState/);
  assert.match(main, /trustedMediaSender\(event\)/);
  assert.match(main, /control\.planBreak\(payload\)/);
  assert.match(main, /control\.stillApproved\(planned\)/);
});
