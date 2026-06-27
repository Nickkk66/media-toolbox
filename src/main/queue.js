'use strict';

// Serial job queue (concurrency 1 — most reliable, respects consumer NVENC
// session caps). Emits per-job and overall progress via the provided callbacks.

const runJob = require('./ffmpeg/runJob');
const { attach } = require('./ffmpeg/progress');

class Queue {
  constructor(callbacks = {}) {
    this.callbacks = callbacks; // { onProgress, onDone, onError, onLog }
    this.jobs = new Map(); // jobId -> { spec, status, percent, controller }
    this.order = [];
    this.running = false;
  }

  add(spec) {
    this.jobs.set(spec.jobId, { spec, status: 'queued', percent: 0, controller: null });
    this.order.push(spec.jobId);
    this._pump();
  }

  cancel(jobId) {
    const entry = this.jobs.get(jobId);
    if (!entry) return;
    if (entry.status === 'running' && entry.controller) {
      entry.controller.cancel();
    } else if (entry.status === 'queued') {
      entry.status = 'canceled';
      this._emitError(jobId, 'canceled');
    }
  }

  cancelAll() {
    for (const jobId of this.order) this.cancel(jobId);
  }

  _overall() {
    const entries = [...this.jobs.values()];
    if (!entries.length) return 0;
    const sum = entries.reduce((a, e) => {
      if (e.status === 'done') return a + 100;
      if (e.status === 'running') return a + e.percent;
      return a;
    }, 0);
    return sum / entries.length;
  }

  async _pump() {
    if (this.running) return;
    const next = this.order.find((id) => this.jobs.get(id).status === 'queued');
    if (!next) return;

    this.running = true;
    const entry = this.jobs.get(next);
    entry.status = 'running';

    const controller = runJob.run(entry.spec, attach, {
      onProgress: (p) => {
        entry.percent = p.percent;
        if (this.callbacks.onProgress) {
          this.callbacks.onProgress({ ...p, overall: this._overall() });
        }
      },
      onLog: (line) => this.callbacks.onLog && this.callbacks.onLog(next, line),
    });
    entry.controller = controller;

    try {
      const result = await controller.promise;
      entry.status = 'done';
      entry.percent = 100;
      if (this.callbacks.onDone) {
        this.callbacks.onDone({ ...result, overall: this._overall() });
      }
    } catch (err) {
      const msg = String(err.message || err);
      entry.status = msg.includes('canceled') ? 'canceled' : 'error';
      this._emitError(next, msg);
    } finally {
      this.running = false;
      this._pump();
    }
  }

  _emitError(jobId, message) {
    if (this.callbacks.onError) {
      this.callbacks.onError({ jobId, message, overall: this._overall() });
    }
  }
}

module.exports = { Queue };
