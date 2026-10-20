import assert from 'node:assert/strict';
import { KillerSudokuService } from '../src/services/killer-sudoku.service.js';

async function run() {
  console.log('Testing KillerSudokuService validation and fallback...');

  // 1. Kiểm tra unauthorized khi thiếu MSSV
  await assert.rejects(
    async () => KillerSudokuService.getProgress(null),
    (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.code, 'UNAUTHORIZED');
      return true;
    }
  );

  await assert.rejects(
    async () => KillerSudokuService.recordCompletion({ mssv: null, difficulty: 'easy', levelId: '1' }),
    (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.code, 'UNAUTHORIZED');
      return true;
    }
  );

  console.log('KillerSudokuService tests passed successfully!');
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
