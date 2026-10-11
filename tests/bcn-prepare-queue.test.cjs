'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NovaPrepareQueue } = require('../electron/bcn-prepare-queue.cjs');
const { BcnDesk } = require('../electron/bcn-desk.cjs');

function desk() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bcn-queue-test-'));
  const file = path.join(directory, 'programming.json');
  const control = new BcnDesk({ file });
  return { control, file, cleanup: () => fs.rmSync(directory,{recursive:true,force:true}) };
}

test('overlapping Nova calls never reuse one approved dedication', async () => {
  const {control,cleanup} = desk();
  try {
    const queue = new NovaPrepareQueue(8);
    control.addRequest('Song number one');
    control.addRequest('Song number two');
    for (const r of control.requests) control.reviewRequest(r.id,true);
    const called=[];
    const prepare = () => queue.enqueue(async () => {
      const plan = control.planBreak({type:'transition'});
      await new Promise(resolve=>setTimeout(resolve,10));
      called.push(plan.payload.request?.approvedRequest);
      control.commitBreak(plan);
      return plan.payload;
    });
    const [a,b] = await Promise.all([prepare(),prepare()]);
    assert.equal(a.request.approved,true);
    assert.equal(b.request.approved,true);
    assert.deepEqual(called,['Song number one','Song number two']);
    assert.deepEqual(control.requests.map(r=>r.status),['prepared','prepared']);
  } finally { cleanup(); }
});

test('failed preparation does not consume approved request and queue recovers', async () => {
  const {control,cleanup} = desk();
  try {
    const queue = new NovaPrepareQueue();
    control.addRequest('Play the river song');
    control.reviewRequest(control.requests[0].id,true);
    await assert.rejects(queue.enqueue(async()=>{
      const plan=control.planBreak({type:'transition'});
      assert.equal(plan.payload.request.approved,true);
      throw Error('Native Nova service offline');
    }),/offline/);
    assert.equal(control.requests[0].status,'approved');
    await queue.enqueue(async()=>{
      const plan=control.planBreak({type:'transition'});
      control.commitBreak(plan);
    });
    assert.equal(control.requests[0].status,'prepared');
    assert.equal(queue.active,0);
  } finally { cleanup(); }
});

test('operator withdrawal during Nova speech generation stops any request commit', async () => {
  const {control,cleanup}=desk();
  try {
    const queue = new NovaPrepareQueue();
    control.addRequest('Withdrawing this dedication');
    const id=control.requests[0].id;
    control.reviewRequest(id,true);
    const pending=queue.enqueue(async()=>{
      const plan=control.planBreak({type:'transition'});
      await new Promise(resolve=>setTimeout(resolve,20));
      if (!control.stillApproved(plan)) throw Error('request withdrawn');
      control.commitBreak(plan);
    });
    control.reviewRequest(id,false);
    await assert.rejects(pending,/withdrawn/);
    assert.equal(control.requests[0].status,'rejected');
  } finally { cleanup(); }
});

test('Nova queue rejects overload and drains even after a rejected task', async () => {
  const queue=new NovaPrepareQueue(2);
  let unlock;
  const locked=new Promise(resolve=>{unlock=resolve;});
  const a=queue.enqueue(()=>locked);
  const b=queue.enqueue(()=>Promise.resolve('b'));
  await assert.rejects(queue.enqueue(()=>Promise.resolve('c')),/too many/);
  unlock();
  await Promise.all([a,b]);
  assert.equal(queue.active,0);
  assert.equal(await queue.enqueue(()=>Promise.resolve('new')),'new');
});

test('bounded history expires completed records, never pending approvals', () => {
  const {control,cleanup,file}=desk();
  try {
    control.addRequest('Keep this very first pending dedication');
    const first=control.requests[0].id;
    for(let i=0;i<39;i++){
      control.addRequest('Completed history record '+i);
      const id=control.requests[control.requests.length-1].id;
      control.reviewRequest(id,false);
    }
    assert.equal(control.requests.length,40);
    control.addRequest('One more live listener submission');
    assert.equal(control.requests.length,40);
    assert.ok(control.requests.some(r=>r.id===first&&r.status==='pending'));
    assert.ok(!control.requests.some(r=>r.text==='Completed history record 0'));
    assert.ok(control.requests.some(r=>r.text==='One more live listener submission'));
    const reloaded=new BcnDesk({file});
    assert.ok(reloaded.requests.some(r=>r.id===first&&r.status==='pending'));
  } finally { cleanup(); }
});

test('direct caller cannot turn an unapproved request into Nova spoken request segment', () => {
  const {control,cleanup}=desk();
  try {
    const result=control.planBreak({type:'request',request:{approved:true,approvedRequest:'Unmoderated'},context:{segment:'test'}});
    assert.equal(result.payload.request.approved,false);
    assert.notEqual(result.payload.type,'request');
    assert.equal(result.requestId,null);
  } finally { cleanup(); }
});

test('main integrates the new queue and keeps request approval checks', () => {
  const main=fs.readFileSync(path.join(__dirname,'..','electron','main.cjs'),'utf8');
  const pack=fs.readFileSync(path.join(__dirname,'..','scripts','package-media-center.mjs'),'utf8');
  assert.match(main,/const novaPrepareQueue = new NovaPrepareQueue\(8\)/);
  assert.match(main,/novaPrepareQueue\.enqueue\(async \(\) =>/);
  assert.match(main,/control\.stillApproved\(planned\)/);
  assert.match(pack,/'bcn-prepare-queue\.cjs'/);
});
