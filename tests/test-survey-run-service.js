import assert from 'node:assert/strict';
import { SurveyRunManager } from '../src/services/survey-run.service.js';

let resolveBackendRun;
let executeCount = 0;
const manager = new SurveyRunManager({
  runSurvey: async ({ onLog, onCourseDone }) => {
    executeCount += 1;
    onLog({ type: 'info', message: 'Đã kết nối BDU.', timestamp: '10:00:00' });
    onCourseDone({ surveyKey: 'course-a' });
    await new Promise((resolve) => { resolveBackendRun = resolve; });
    onLog({ type: 'success', message: 'Đã hoàn thành.', timestamp: '10:00:01' });
    return { success: true, processed: 1, total: 1, message: 'Đã hoàn tất 1/1 môn.' };
  }
});

const started = manager.start({ mssv: '24050123', token: 'secret-token', options: { ratingLevel: '5' } });
const sameStudent = manager.start({ mssv: '24050123', token: 'other-token', options: { ratingLevel: '3' } });
assert.equal(sameStudent.reused, true, 'Một sinh viên chỉ được có một lượt khảo sát đang chạy');
assert.equal(sameStudent.run.runId, started.run.runId, 'Lượt reconnect phải dùng cùng run ID');

const events = [];
const unsubscribe = manager.subscribe(started.run.runId, (event) => events.push(event));
await Promise.resolve();

const running = manager.getForStudent(started.run.runId, '24050123');
assert.equal(executeCount, 1, 'Backend chỉ khởi chạy một lần');
assert.equal(running.status, 'running');
assert.deepEqual(running.completedKeys, ['course-a']);
assert.equal(running.token, undefined, 'Token không được lộ trong snapshot');
assert.equal(manager.getForStudent(started.run.runId, '24050000'), null, 'Không được đọc run của sinh viên khác');

resolveBackendRun();
await new Promise((resolve) => setImmediate(resolve));

const completed = manager.getForStudent(started.run.runId, '24050123');
assert.equal(completed.status, 'success');
assert.equal(completed.result.processed, 1);
assert.equal(events.some((event) => event.type === 'done'), true, 'Subscriber phải nhận terminal event');
unsubscribe();

console.log('✓ Survey runs survive SSE disconnects, deduplicate starts, and keep bearer tokens out of snapshots.');
