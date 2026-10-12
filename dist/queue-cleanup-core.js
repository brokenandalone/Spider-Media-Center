/* Queue cleanup plans. Pure logic shared by the Electron playback engine and tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SpiderQueueCleanupCore = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const hasMedia = track => Boolean(track && typeof track === 'object' && typeof track.url === 'string' && track.url.trim());
  function clearUpcoming(items, currentIndex) {
    const queue = Array.isArray(items) ? items : [];
    const active = Number.isInteger(currentIndex) && currentIndex >= 0 &&
      currentIndex < queue.length && hasMedia(queue[currentIndex]) ? queue[currentIndex] : null;
    return Object.freeze({
      queue: active ? [active] : [],
      currentIndex: active ? 0 : -1,
      removed: queue.length - (active ? 1 : 0),
      keptCurrent: Boolean(active)
    });
  }
  function clearAll(items) {
    return Object.freeze({queue:[],currentIndex:-1,removed:Array.isArray(items) ? items.length : 0,keptCurrent:false});
  }
  function removeEmptyRows(items, currentIndex) {
    const queue=Array.isArray(items)?items:[];
    const active = Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;
    const clean=queue.filter(hasMedia);
    return Object.freeze({queue:clean,currentIndex:active && hasMedia(active) ? clean.indexOf(active) : -1,
      removed:queue.length-clean.length,keptCurrent:Boolean(active && hasMedia(active))});
  }
  return Object.freeze({clearUpcoming,clearAll,removeEmptyRows,hasMedia});
});
