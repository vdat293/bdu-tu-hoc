/**
 * Killer Sudoku Core Engine & Solver
 * Logic for puzzle decoding, cage parsing, validation, combinations, and hints.
 */

const KillerEngine = (function() {
  'use strict';

  // Precomputed combinations cache for cage sums
  const COMBINATIONS_CACHE = {};

  function computeCombinations(targetSum, size, minDigit = 1, current = []) {
    if (size === 0) {
      if (targetSum === 0) return [current];
      return [];
    }
    const results = [];
    for (let d = minDigit; d <= 9; d++) {
      if (d > targetSum) break;
      const sub = computeCombinations(targetSum - d, size - 1, d + 1, [...current, d]);
      results.push(...sub);
    }
    return results;
  }

  function getCageCombinations(sum, size) {
    const key = `${sum}_${size}`;
    if (!COMBINATIONS_CACHE[key]) {
      COMBINATIONS_CACHE[key] = computeCombinations(sum, size);
    }
    return COMBINATIONS_CACHE[key];
  }

  /**
   * Filter combinations with required (includes) and forbidden (excludes) digits
   */
  function getFilteredCombinations(sum, size, includes = [], excludes = []) {
    const all = getCageCombinations(sum, size);
    const incSet = new Set(includes.map(Number));
    const excSet = new Set(excludes.map(Number));

    return all.filter(combo => {
      // Must contain all required digits
      for (const inc of incSet) {
        if (!combo.includes(inc)) return false;
      }
      // Must not contain any forbidden digits
      for (const exc of excSet) {
        if (combo.includes(exc)) return false;
      }
      return true;
    });
  }

  /**
   * Calculate valid candidate digits for an empty cell based on Sudoku & Killer rules
   */
  function getCandidates(board, puzzle, cellIdx) {
    if (board[cellIdx] > 0) return new Set();

    const candidates = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const row = Math.floor(cellIdx / 9);
    const col = cellIdx % 9;
    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;
    const cageId = puzzle.cages[cellIdx];
    const cage = puzzle.cageMap[cageId];

    // Eliminate row digits
    for (let c = 0; c < 9; c++) {
      const v = board[row * 9 + c];
      if (v > 0) candidates.delete(v);
    }

    // Eliminate col digits
    for (let r = 0; r < 9; r++) {
      const v = board[r * 9 + col];
      if (v > 0) candidates.delete(v);
    }

    // Eliminate 3x3 box digits
    for (let r = boxRow; r < boxRow + 3; r++) {
      for (let c = boxCol; c < boxCol + 3; c++) {
        const v = board[r * 9 + c];
        if (v > 0) candidates.delete(v);
      }
    }

    // Eliminate cage digits already placed
    let placedSum = 0;
    const placedDigits = [];
    cage.cells.forEach(idx => {
      const v = board[idx];
      if (v > 0) {
        placedSum += v;
        placedDigits.push(v);
        candidates.delete(v);
      }
    });

    // Killer cage combinations filter
    const remainingSum = cage.sum - placedSum;
    const remainingCells = cage.cells.filter(idx => board[idx] === 0).length;

    if (remainingCells > 0 && remainingSum > 0) {
      const validCombos = getCageCombinations(cage.sum, cage.cells.length)
        .filter(combo => placedDigits.every(d => combo.includes(d)));

      const allowedInCage = new Set();
      validCombos.forEach(combo => {
        combo.forEach(d => {
          if (!placedDigits.includes(d)) allowedInCage.add(d);
        });
      });

      for (const d of Array.from(candidates)) {
        if (!allowedInCage.has(d)) candidates.delete(d);
      }
    }

    return candidates;
  }

  /**
   * Parse APK puzzle string format:
   * "id;board_string;cages_csv"
   * e.g. "369;adFicheg...;0,0,1,1,2,2..."
   */
  function parsePuzzle(rawStr) {
    if (!rawStr) return null;
    const parts = rawStr.trim().split(';');
    if (parts.length < 3) return null;

    const id = parts[0];
    const boardStr = parts[1];
    const cageArray = parts[2].split(',').map(Number);

    const solution = [];
    const givens = [];

    for (let i = 0; i < boardStr.length; i++) {
      const ch = boardStr[i];
      const val = ch.toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0) + 1;
      solution.push(val);
      givens.push(ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? val : 0);
    }

    // Build cage information
    const cageMap = {};
    for (let i = 0; i < 81; i++) {
      const cid = cageArray[i];
      if (!cageMap[cid]) {
        cageMap[cid] = {
          id: cid,
          cells: [],
          sum: 0,
          labelCell: -1
        };
      }
      cageMap[cid].cells.push(i);
      cageMap[cid].sum += solution[i];
    }

    // Determine the label cell (top-leftmost cell in visual reading order)
    Object.values(cageMap).forEach(cage => {
      cage.cells.sort((a, b) => a - b);
      cage.labelCell = cage.cells[0];
    });

    return {
      id,
      solution,
      givens,
      cages: cageArray,
      cageMap
    };
  }

  /**
   * Validate board state and detect conflicts.
   * Returns: { conflicts: Set<number>, isComplete: boolean, isCorrect: boolean, cageStatuses: Map }
   */
  function validateBoard(board, cages, cageMap) {
    const conflicts = new Set();
    const cageStatuses = {}; // cid -> { currentSum, isFull, isExceeded, hasDuplicate }

    // 1. Check Row conflicts
    for (let r = 0; r < 9; r++) {
      const seen = new Map();
      for (let c = 0; c < 9; c++) {
        const idx = r * 9 + c;
        const val = board[idx];
        if (val > 0) {
          if (seen.has(val)) {
            conflicts.add(idx);
            conflicts.add(seen.get(val));
          } else {
            seen.set(val, idx);
          }
        }
      }
    }

    // 2. Check Column conflicts
    for (let c = 0; c < 9; c++) {
      const seen = new Map();
      for (let r = 0; r < 9; r++) {
        const idx = r * 9 + c;
        const val = board[idx];
        if (val > 0) {
          if (seen.has(val)) {
            conflicts.add(idx);
            conflicts.add(seen.get(val));
          } else {
            seen.set(val, idx);
          }
        }
      }
    }

    // 3. Check 3x3 Box conflicts
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        const seen = new Map();
        for (let r = br * 3; r < br * 3 + 3; r++) {
          for (let c = bc * 3; c < bc * 3 + 3; c++) {
            const idx = r * 9 + c;
            const val = board[idx];
            if (val > 0) {
              if (seen.has(val)) {
                conflicts.add(idx);
                conflicts.add(seen.get(val));
              } else {
                seen.set(val, idx);
              }
            }
          }
        }
      }
    }

    // 4. Check Cage rules (sum & unique digits)
    let allCagesValid = true;
    for (const cid in cageMap) {
      const cage = cageMap[cid];
      let currentSum = 0;
      let filledCount = 0;
      const seen = new Map();
      let hasDup = false;

      cage.cells.forEach(idx => {
        const val = board[idx];
        if (val > 0) {
          currentSum += val;
          filledCount++;
          if (seen.has(val)) {
            conflicts.add(idx);
            conflicts.add(seen.get(val));
            hasDup = true;
          } else {
            seen.set(val, idx);
          }
        }
      });

      const isFull = filledCount === cage.cells.length;
      const isExceeded = currentSum > cage.sum;
      const isSumCorrect = isFull && currentSum === cage.sum;

      if (isExceeded) {
        cage.cells.forEach(idx => {
          if (board[idx] > 0) conflicts.add(idx);
        });
      } else if (isFull && currentSum !== cage.sum) {
        cage.cells.forEach(idx => conflicts.add(idx));
      }

      cageStatuses[cid] = {
        currentSum,
        targetSum: cage.sum,
        filledCount,
        totalCells: cage.cells.length,
        isFull,
        isExceeded,
        hasDuplicate: hasDup,
        isComplete: isSumCorrect && !hasDup
      };

      if (!isSumCorrect || hasDup) {
        allCagesValid = false;
      }
    }

    // Check complete
    const isFullBoard = board.every(v => v > 0);
    const isCorrect = isFullBoard && conflicts.size === 0 && allCagesValid;

    return {
      conflicts,
      isFullBoard,
      isCorrect,
      cageStatuses
    };
  }

  return {
    parsePuzzle,
    getCageCombinations,
    getFilteredCombinations,
    getCandidates,
    validateBoard
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = KillerEngine;
}
