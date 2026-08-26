/**
 * High-Performance In-Memory Concurrency Queue
 * Zero-dependency task scheduler with strict concurrency limiting and statistics
 */

export class AsyncQueue {
  /**
   * @param {Object} options
   * @param {number} [options.concurrency=3] - Maximum number of concurrent tasks
   * @param {string} [options.name='DefaultQueue'] - Friendly name for logging
   */
  constructor({ concurrency = 3, name = 'DefaultQueue' } = {}) {
    this.concurrency = Math.max(1, concurrency);
    this.name = name;
    this.queue = [];
    this.activeCount = 0;
    this.totalProcessed = 0;
    this.totalFailed = 0;
  }

  /**
   * Add an async task function to the queue
   * @param {Function} taskFn - Async function returning a Promise
   * @returns {Promise<any>}
   */
  enqueue(taskFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        taskFn,
        resolve,
        reject,
        enqueuedAt: Date.now()
      });

      this._processNext();
    });
  }

  /**
   * Internal scheduler to execute the next pending task
   * @private
   */
  async _processNext() {
    if (this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.activeCount++;

    try {
      const result = await item.taskFn();
      this.totalProcessed++;
      this.activeCount--;
      this._processNext();
      item.resolve(result);
    } catch (err) {
      this.totalFailed++;
      this.activeCount--;
      this._processNext();
      item.reject(err);
    }
  }

  /**
   * Get realtime queue metrics
   */
  getStats() {
    return {
      name: this.name,
      concurrency: this.concurrency,
      activeCount: this.activeCount,
      queuedCount: this.queue.length,
      totalProcessed: this.totalProcessed,
      totalFailed: this.totalFailed
    };
  }

  /**
   * Clear all pending tasks in the queue (optional emergency purge)
   */
  clear(reason = 'Hàng đợi đã bị hủy.') {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      item.reject(new Error(reason));
    }
  }
}
