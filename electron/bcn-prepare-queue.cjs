'use strict';

// Bound and serialize Nova's asynchronous requests. The BCN desk only changes
// an approval to "prepared" after audio is successfully generated. Without a
// serial gate, simultaneous track-ending events can consume the same approval.
class NovaPrepareQueue {
  constructor(limit = 8) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid prepare queue capacity');
    this.limit = limit;
    this.active = 0;
    this.tail = Promise.resolve();
  }
  enqueue(task) {
    if (typeof task !== 'function') return Promise.reject(new TypeError('Prepare task must be a function'));
    if (this.active >= this.limit) {
      return Promise.reject(new Error('Nova is already preparing too many breaks. Please try again.'));
    }
    this.active += 1;
    const run = this.tail.then(task, task);
    this.tail = run.then(() => {}, () => {});
    return run.finally(() => { this.active -= 1; });
  }
}
module.exports = { NovaPrepareQueue };
