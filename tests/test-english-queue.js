import assert from 'node:assert/strict';
import { EnglishExerciseInternals } from '../src/services/english-exercise.service.js';

const { EnglishExerciseQueueManager } = EnglishExerciseInternals;

function createMockSession() {
  return {
    logs: [],
    subscribers: new Set(),
    job: null
  };
}

// Test 1: Concurrency limit and queueing
const queue = new EnglishExerciseQueueManager(2); // limit 2 concurrent
assert.equal(queue.maxConcurrency, 2);
assert.equal(queue.runningCount, 0);
assert.equal(queue.waitingCount, 0);

let job1Finished = false;
let job2Finished = false;
let job3Started = false;
let job4Started = false;

let resolveJob1;
const job1Promise = new Promise(resolve => { resolveJob1 = resolve; });

let resolveJob2;
const job2Promise = new Promise(resolve => { resolveJob2 = resolve; });

const session1 = createMockSession();
const session2 = createMockSession();
const session3 = createMockSession();
const session4 = createMockSession();

// Enqueue Job 1
queue.enqueue({
  id: 'job-1',
  session: session1,
  controller: new AbortController(),
  runFn: async () => {
    await job1Promise;
    job1Finished = true;
  }
});

// Enqueue Job 2
queue.enqueue({
  id: 'job-2',
  session: session2,
  controller: new AbortController(),
  runFn: async () => {
    await job2Promise;
    job2Finished = true;
  }
});

assert.equal(queue.runningCount, 2, '2 jobs should be running');
assert.equal(queue.waitingCount, 0, '0 jobs waiting');

// Enqueue Job 3 (should be queued at pos 1)
queue.enqueue({
  id: 'job-3',
  session: session3,
  controller: new AbortController(),
  runFn: async () => {
    job3Started = true;
  }
});

assert.equal(queue.runningCount, 2);
assert.equal(queue.waitingCount, 1);
assert.equal(queue.getQueuePosition('job-3'), 1);

// Enqueue Job 4 (should be queued at pos 2)
queue.enqueue({
  id: 'job-4',
  session: session4,
  controller: new AbortController(),
  runFn: async () => {
    job4Started = true;
  }
});

assert.equal(queue.runningCount, 2);
assert.equal(queue.waitingCount, 2);
assert.equal(queue.getQueuePosition('job-4'), 2);

// Test 2: Cancelling a queued job
const cancelled3 = queue.cancel('job-3');
assert.equal(cancelled3, true, 'Job 3 should be successfully cancelled from queue');
assert.equal(queue.waitingCount, 1, 'Waiting count should be 1 after cancelling Job 3');
assert.equal(queue.getQueuePosition('job-4'), 1, 'Job 4 should now be promoted to position 1');

// Test 3: Finishing Job 1 promotes Job 4 from queue to running
resolveJob1();
await new Promise(r => setTimeout(r, 50)); // wait for microtask & promise resolution

assert.equal(job1Finished, true, 'Job 1 should be finished');
assert.equal(job4Started, true, 'Job 4 should have started running');
assert.equal(queue.waitingCount, 0, 'No more waiting jobs');

// Finish Job 2
resolveJob2();
await new Promise(r => setTimeout(r, 50));
assert.equal(job2Finished, true, 'Job 2 should be finished');

console.log('✓ All EnglishExerciseQueueManager concurrency and queue tests passed!');
