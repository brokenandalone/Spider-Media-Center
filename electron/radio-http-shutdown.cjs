'use strict';

// A mobile audio stream is deliberately long-lived. server.close() stops new
// clients but can wait forever for existing stream/keep-alive connections.
// Shut down deliberately: stop accepting, allow a short graceful drain,
// then close any remaining HTTP connections, with a hard failure deadline.
function closeRadioHttpServer(server, options = {}) {
  if (!server) return Promise.resolve({ closed: true, forced: false });
  if (typeof server.close !== 'function') {
    return Promise.reject(new TypeError('A Node HTTP server is required'));
  }

  const graceMs = options.graceMs ?? 1200;
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isFinite(graceMs) || graceMs < 0 ||
      !Number.isFinite(timeoutMs) || timeoutMs <= graceMs) {
    return Promise.reject(new RangeError('Invalid shutdown deadlines'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let forced = false;
    let graceTimer;
    let deadlineTimer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(graceTimer);
      clearTimeout(deadlineTimer);
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve({ closed: true, forced });
    };
    try {
      server.close(finish);
      // Node 19+ closes idle connections from close(); explicitly support
      // older bundled Electron runtimes without touching active streams.
      server.closeIdleConnections?.();
    } catch (error) {
      finish(error);
      return;
    }
    if (settled) return;
    graceTimer = setTimeout(() => {
      if (settled) return;
      forced = true;
      try {
        // Only destroys sockets owned by this broadcast HTTP server.
        server.closeAllConnections?.();
      } catch (error) {
        finish(error);
      }
    }, graceMs);
    deadlineTimer = setTimeout(() => {
      if (settled) return;
      try { server.closeAllConnections?.(); } catch {}
      finish(new Error('BCN radio HTTP server could not close before the shutdown deadline'));
    }, timeoutMs);
  });
}

module.exports = { closeRadioHttpServer };
