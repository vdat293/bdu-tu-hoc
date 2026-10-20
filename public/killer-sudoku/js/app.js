/**
 * Killer Sudoku Web App - Authentic Mobile APK Controller
 * Faithfully recreating the mobile APK layout, 4-color pastel cages,
 * animations, timers, sound effects, and 3,900+ official puzzles.
 */

(function() {
  'use strict';

  // Game State
  const state = {
    difficulty: 'expert',
    puzzleIndex: 0,
    puzzle: null,
    board: new Array(81).fill(0),
    notes: Array.from({ length: 81 }, () => new Set()),
    selectedCell: 0,
    isNotesMode: false,
    history: [],
    redoStack: [],
    timerSeconds: 0,
    timerInterval: null,
    isPaused: false,
    mistakes: 0,
    maxMistakes: 3,
    mistakeLimit: true,
    autoRemoveNotes: true,
    allTimeScore: 21640,
    hintsLeft: 1,
    conflicts: new Set(),
    isComplete: false,
    theme: 'pastel'
  };

  const THEMES = ['pastel', 'dark', 'sepia', 'forest'];

  // DOM Elements cache
  let dom = {};

  function init() {
    cacheDom();
    bindEvents();
    loadPreferences();

    const savedDiff = localStorage.getItem('killer_last_diff');
    const savedIdx = localStorage.getItem('killer_last_index');

    if (savedDiff && savedIdx !== null && window.KILLER_PUZZLES_RAW && window.KILLER_PUZZLES_RAW[savedDiff]) {
      loadLevel(savedDiff, parseInt(savedIdx, 10));
    } else {
      // Mặc định khởi đầu bằng độ khó Dễ (Easy) màn 1
      state.difficulty = 'easy';
      loadLevel('easy', 0);
    }
  }

  function cacheDom() {
    dom = {
      // Header
      btnBack: document.getElementById('btnBack'),
      levelTitle: document.getElementById('levelTitle'),
      btnThemeToggle: document.getElementById('btnThemeToggle'),
      btnSettings: document.getElementById('btnSettings'),

      // Status Bar
      allTimeScoreDisplay: document.getElementById('allTimeScoreDisplay'),
      diffDisplay: document.getElementById('diffDisplay'),
      mistakesDisplay: document.getElementById('mistakesDisplay'),
      timerDisplay: document.getElementById('timerDisplay'),
      btnPause: document.getElementById('btnPause'),
      pauseOverlay: document.getElementById('pauseOverlay'),
      btnResume: document.getElementById('btnResume'),

      // Board
      board: document.getElementById('sudokuBoard'),

      // Action Tools
      btnUndo: document.getElementById('btnUndo'),
      btnErase: document.getElementById('btnErase'),
      btnNotes: document.getElementById('btnNotes'),
      notesBadge: document.getElementById('notesBadge'),
      btnHint: document.getElementById('btnHint'),
      hintBadge: document.getElementById('hintBadge'),

      // Keypad
      numKeys: document.querySelectorAll('.num-key'),

      // Cage Helper Info
      cageTargetSum: document.getElementById('cageTargetSum'),
      cageRemaining: document.getElementById('cageRemaining'),
      combosList: document.getElementById('combosList'),

      // Modals
      pickerModal: document.getElementById('pickerModal'),
      btnClosePicker: document.getElementById('btnClosePicker'),
      diffTabs: document.querySelectorAll('.diff-tab'),
      pickerGrid: document.getElementById('pickerGrid'),

      settingsModal: document.getElementById('settingsModal'),
      btnCloseSettings: document.getElementById('btnCloseSettings'),
      themeSelect: document.getElementById('themeSelect'),
      chkSound: document.getElementById('chkSound'),
      chkMistakeLimit: document.getElementById('chkMistakeLimit'),
      chkAutoRemoveNotes: document.getElementById('chkAutoRemoveNotes'),
      btnAutoNotes: document.getElementById('btnAutoNotes'),

      winModal: document.getElementById('winModal'),
      btnNextLevel: document.getElementById('btnNextLevel'),
      btnPlayAgain: document.getElementById('btnPlayAgain'),
      winTime: document.getElementById('winTime'),
      winMistakes: document.getElementById('winMistakes'),
      winScore: document.getElementById('winScore')
    };
  }

  function bindEvents() {
    // Header actions
    dom.btnBack.addEventListener('click', openLevelPicker);
    dom.levelTitle.addEventListener('click', openLevelPicker);
    const btnQuickPicker = document.getElementById('btnQuickPicker');
    if (btnQuickPicker) btnQuickPicker.addEventListener('click', openLevelPicker);
    const btnRandomLevel = document.getElementById('btnRandomLevel');
    if (btnRandomLevel) {
      btnRandomLevel.addEventListener('click', () => {
        if (!window.KILLER_PUZZLES_RAW) return;
        const pool = window.KILLER_PUZZLES_RAW[state.difficulty] || window.KILLER_PUZZLES_RAW['expert'];
        if (!pool || pool.length === 0) return;
        const randIdx = Math.floor(Math.random() * pool.length);
        loadLevel(state.difficulty, randIdx);
        SoundManager.playClick();
      });
    }
    dom.btnThemeToggle.addEventListener('click', cycleTheme);
    dom.btnSettings.addEventListener('click', openSettings);

    // Pause & Resume
    dom.btnPause.addEventListener('click', togglePause);
    dom.btnResume.addEventListener('click', togglePause);

    // Board cell clicking
    dom.board.addEventListener('click', e => {
      const cell = e.target.closest('.cell');
      if (cell) {
        const idx = parseInt(cell.dataset.index, 10);
        selectCell(idx);
        SoundManager.playClick();
      }
    });

    // Keypad clicking
    dom.numKeys.forEach(btn => {
      btn.addEventListener('click', () => {
        const num = parseInt(btn.dataset.num, 10);
        handleNumberInput(num);
      });
    });

    // Action tools
    dom.btnUndo.addEventListener('click', undoAction);
    dom.btnErase.addEventListener('click', eraseSelected);
    dom.btnNotes.addEventListener('click', toggleNotesMode);
    dom.btnHint.addEventListener('click', giveSmartHint);

    // Level Picker
    dom.btnClosePicker.addEventListener('click', closeLevelPicker);
    dom.pickerModal.addEventListener('click', e => {
      if (e.target === dom.pickerModal) closeLevelPicker();
    });
    dom.diffTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const diff = tab.dataset.diff;
        dom.diffTabs.forEach(t => t.classList.toggle('active', t === tab));
        renderLevelGrid(diff);
      });
    });

    // Settings
    dom.btnCloseSettings.addEventListener('click', closeSettings);
    dom.settingsModal.addEventListener('click', e => {
      if (e.target === dom.settingsModal) closeSettings();
    });
    dom.themeSelect.addEventListener('change', e => setTheme(e.target.value));
    dom.chkSound.addEventListener('change', e => {
      SoundManager.setEnabled(e.target.checked);
      localStorage.setItem('killer_sound_enabled', e.target.checked ? 'true' : 'false');
    });
    dom.chkMistakeLimit.addEventListener('change', e => {
      state.mistakeLimit = e.target.checked;
      updateMistakesDisplay();
    });
    dom.chkAutoRemoveNotes.addEventListener('change', e => {
      state.autoRemoveNotes = e.target.checked;
    });
    if (dom.btnAutoNotes) {
      dom.btnAutoNotes.addEventListener('click', () => {
        fillAutoNotes();
        closeSettings();
      });
    }

    // Win Modal actions
    dom.btnNextLevel.addEventListener('click', () => {
      dom.winModal.classList.add('hidden');
      loadLevel(state.difficulty, state.puzzleIndex + 1);
    });
    dom.btnPlayAgain.addEventListener('click', () => {
      dom.winModal.classList.add('hidden');
      loadLevel(state.difficulty, state.puzzleIndex);
    });

    // Keyboard support
    window.addEventListener('keydown', handleKeyboard);
  }

  function loadPreferences() {
    const savedTheme = localStorage.getItem('killer_sudoku_theme') || 'pastel';
    setTheme(savedTheme);

    const soundSaved = localStorage.getItem('killer_sound_enabled');
    if (soundSaved !== null) {
      const enabled = soundSaved === 'true';
      SoundManager.setEnabled(enabled);
      if (dom.chkSound) dom.chkSound.checked = enabled;
    }
  }

  function setTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'pastel';
    state.theme = theme;
    document.body.dataset.theme = theme;
    if (dom.themeSelect) dom.themeSelect.value = theme;
    localStorage.setItem('killer_sudoku_theme', theme);
  }

  function cycleTheme() {
    const currIdx = THEMES.indexOf(state.theme);
    const nextTheme = THEMES[(currIdx + 1) % THEMES.length];
    setTheme(nextTheme);
    SoundManager.playClick();
  }

  function formatDiffName(diff) {
    switch(diff) {
      case 'easy': return 'Dễ';
      case 'medium': return 'Vừa';
      case 'hard': return 'Khó';
      case 'expert': return 'Chuyên gia';
      case 'daily_expert': return 'Chuyên gia';
      case 'daily_easy': return 'Dễ';
      default: return 'Chuyên gia';
    }
  }

  function updateMistakesDisplay() {
    if (state.mistakeLimit) {
      dom.mistakesDisplay.textContent = `${state.mistakes}/${state.maxMistakes}`;
    } else {
      dom.mistakesDisplay.textContent = `${state.mistakes}`;
    }
  }

  function loadLevel(diff, index) {
    if (!window.KILLER_PUZZLES_RAW) return;
    const pool = window.KILLER_PUZZLES_RAW[diff] || window.KILLER_PUZZLES_RAW['expert'] || window.KILLER_PUZZLES_RAW['easy'];
    if (!pool || pool.length === 0) return;

    state.difficulty = diff;
    state.puzzleIndex = (index >= 0 && index < pool.length) ? index : 0;
    localStorage.setItem('killer_last_diff', diff);
    localStorage.setItem('killer_last_index', state.puzzleIndex);
    const raw = pool[state.puzzleIndex];
    state.puzzle = KillerEngine.parsePuzzle(raw);

    // Reset game state
    state.board = [...state.puzzle.givens];
    state.notes = Array.from({ length: 81 }, () => new Set());
    state.history = [];
    state.redoStack = [];
    state.selectedCell = state.puzzle.givens.findIndex(v => v === 0);
    if (state.selectedCell === -1) state.selectedCell = 0;
    state.mistakes = 0;
    state.hintsLeft = 1;
    state.isComplete = false;
    state.isPaused = false;
    state.conflicts = new Set();
    state.lockedCells = new Set();
    state.puzzle.givens.forEach((v, i) => {
      if (v > 0) state.lockedCells.add(i);
    });

    // Update Header and Status row
    dom.levelTitle.textContent = state.puzzle.id || (state.puzzleIndex + 1);
    dom.diffDisplay.textContent = formatDiffName(diff);
    dom.allTimeScoreDisplay.textContent = Number(state.allTimeScore).toLocaleString('en-US');
    if (dom.hintBadge) dom.hintBadge.textContent = state.hintsLeft;
    updateMistakesDisplay();

    renderBoard();
    updateHighlights();
    updateCageInspector();
    updateNumpadCounts();
    startTimer(true);
  }

  /**
   * Assign 4 distinct pastel colors to cages using planar greedy graph coloring
   */
  function assignCageColors(puzzle) {
    const { cages } = puzzle;
    const numCages = Math.max(...cages) + 1;
    const adj = Array.from({ length: numCages }, () => new Set());

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const idx = r * 9 + c;
        const cid = cages[idx];
        if (c < 8) {
          const rightCid = cages[idx + 1];
          if (rightCid !== cid) {
            adj[cid].add(rightCid);
            adj[rightCid].add(cid);
          }
        }
        if (r < 8) {
          const botCid = cages[idx + 9];
          if (botCid !== cid) {
            adj[cid].add(botCid);
            adj[botCid].add(cid);
          }
        }
      }
    }

    // Sort cages by degree descending (Welsh-Powell)
    const order = Array.from({ length: numCages }, (_, i) => i)
      .sort((a, b) => adj[b].size - adj[a].size);

    const cageColors = new Array(numCages).fill(-1);
    for (const cid of order) {
      const used = new Set();
      for (const nb of adj[cid]) {
        if (cageColors[nb] !== -1) used.add(cageColors[nb]);
      }
      let col = 0;
      while (used.has(col)) {
        col++;
      }
      cageColors[cid] = col % 4; // Map into 4 pastel colors: 0, 1, 2, 3
    }
    return cageColors;
  }

  /**
   * Render the 9x9 board with authentic pastel cages and inset dashed borders
   */
  function renderBoard() {
    dom.board.innerHTML = '';
    const { cages, cageMap } = state.puzzle;
    const cageColors = assignCageColors(state.puzzle);

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const idx = r * 9 + c;
        const cid = cages[idx];
        const colorIdx = cageColors[cid];

        const cell = document.createElement('div');
        cell.className = `cell cage-c${colorIdx}`;
        cell.dataset.index = idx;
        cell.dataset.row = r;
        cell.dataset.col = c;
        cell.dataset.cage = cid;

        // Inset dashed border boundaries
        if (r === 0 || cages[(r - 1) * 9 + c] !== cid) cell.classList.add('cage-top');
        if (r === 8 || cages[(r + 1) * 9 + c] !== cid) cell.classList.add('cage-bottom');
        if (c === 0 || cages[r * 9 + (c - 1)] !== cid) cell.classList.add('cage-left');
        if (c === 8 || cages[r * 9 + (c + 1)] !== cid) cell.classList.add('cage-right');

        // Inner dashed outline container
        const outline = document.createElement('div');
        outline.className = 'cell-cage-outline';
        cell.appendChild(outline);

        // Top-Left Cage Sum Label
        if (cageMap[cid].labelCell === idx) {
          const sumLabel = document.createElement('span');
          sumLabel.className = 'cage-sum';
          sumLabel.textContent = cageMap[cid].sum;
          cell.appendChild(sumLabel);
        }

        dom.board.appendChild(cell);
      }
    }
    updateBoardValues();
  }

  /**
   * Update digits & notes inside cells
   */
  function updateBoardValues() {
    const cells = dom.board.children;
    for (let i = 0; i < 81; i++) {
      const cell = cells[i];
      const val = state.board[i];
      const isGiven = state.puzzle.givens[i] > 0;

      // Retain outline and cage-sum label
      const existingDigit = cell.querySelector('.cell-digit');
      if (existingDigit) existingDigit.remove();
      const existingNotes = cell.querySelector('.notes-grid');
      if (existingNotes) existingNotes.remove();

      const isLocked = state.lockedCells && state.lockedCells.has(i);

      cell.classList.toggle('given', isGiven);
      cell.classList.toggle('user-value', !isGiven && val > 0);
      cell.classList.toggle('correct-locked', !isGiven && isLocked && val > 0);
      cell.classList.toggle('error', state.conflicts.has(i));

      if (val > 0) {
        const numSpan = document.createElement('span');
        numSpan.className = 'cell-digit';
        numSpan.textContent = val;
        cell.appendChild(numSpan);
      } else {
        const notesSet = state.notes[i];
        if (notesSet && notesSet.size > 0) {
          const notesGrid = document.createElement('div');
          notesGrid.className = 'notes-grid';
          for (let d = 1; d <= 9; d++) {
            const nSpan = document.createElement('span');
            nSpan.className = 'note-digit';
            nSpan.textContent = notesSet.has(d) ? d : '';
            notesGrid.appendChild(nSpan);
          }
          cell.appendChild(notesGrid);
        }
      }
    }
  }

  function selectCell(idx) {
    if (idx < 0 || idx >= 81) return;
    state.selectedCell = idx;
    updateHighlights();
    updateCageInspector();
  }

  function updateHighlights() {
    const selIdx = state.selectedCell;
    const selRow = Math.floor(selIdx / 9);
    const selCol = selIdx % 9;
    const selVal = state.board[selIdx];
    const selCage = state.puzzle.cages[selIdx];

    const cells = dom.board.children;
    for (let i = 0; i < 81; i++) {
      const c = cells[i];
      const r = Math.floor(i / 9);
      const col = i % 9;
      const val = state.board[i];
      const cage = state.puzzle.cages[i];

      c.classList.toggle('selected', i === selIdx);
      c.classList.toggle('related', i !== selIdx && (r === selRow || col === selCol || (Math.floor(r/3) === Math.floor(selRow/3) && Math.floor(col/3) === Math.floor(selCol/3)) || cage === selCage));
      c.classList.toggle('same-number', selVal > 0 && val === selVal && i !== selIdx);
    }
  }

  function updateCageInspector() {
    if (!state.puzzle) return;
    const selIdx = state.selectedCell;
    const cageId = state.puzzle.cages[selIdx];
    const cage = state.puzzle.cageMap[cageId];

    if (!cage) return;

    let currentSum = 0;
    let filledCount = 0;
    const currentDigits = [];

    cage.cells.forEach(idx => {
      const v = state.board[idx];
      if (v > 0) {
        currentSum += v;
        filledCount++;
        currentDigits.push(v);
      }
    });

    const remainingSum = cage.sum - currentSum;
    const remainingCells = cage.cells.length - filledCount;

    if (dom.cageTargetSum) dom.cageTargetSum.textContent = `Tổng: ${cage.sum}`;
    if (dom.cageRemaining) {
      if (remainingCells === 0) {
        dom.cageRemaining.textContent = currentSum === cage.sum ? '(Đã xong ✓)' : `(Lệch: ${currentSum - cage.sum})`;
        dom.cageRemaining.style.color = currentSum === cage.sum ? '#16a34a' : '#ef4444';
      } else {
        dom.cageRemaining.textContent = `(Còn thiếu ${remainingSum} trong ${remainingCells} ô)`;
        dom.cageRemaining.style.color = '#d97706';
      }
    }

    // Render combinations in mobile inspector
    if (dom.combosList) {
      dom.combosList.innerHTML = '';
      if (remainingCells > 0) {
        const validCombos = KillerEngine.getCageCombinations(cage.sum, cage.cells.length)
          .filter(combo => currentDigits.every(d => combo.includes(d)));

        validCombos.slice(0, 4).forEach(combo => {
          const chip = document.createElement('span');
          chip.className = 'combo-chip';
          chip.textContent = combo.join('+');
          dom.combosList.appendChild(chip);
        });
      }
    }

    // Tự động kiểm tra và đồng bộ tổ hợp sang Bảng Máy Tính (Combinations Helper) bên phải
    if (window.KillerCombinations && typeof window.KillerCombinations.setCage === 'function') {
      window.KillerCombinations.setCage(cage.cells.length, cage.sum, currentDigits, true);
    }
  }

  function updateNumpadCounts() {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 81; i++) {
      const v = state.board[i];
      if (v > 0) counts[v]++;
    }
    dom.numKeys.forEach(btn => {
      const num = parseInt(btn.dataset.num, 10);
      const completed = counts[num] >= 9;
      btn.classList.toggle('completed', completed);
    });
  }

  function handleNumberInput(num) {
    if (state.isComplete || state.isPaused) return;
    const idx = state.selectedCell;
    if (idx < 0 || idx >= 81) return;
    if (state.lockedCells && state.lockedCells.has(idx)) return; // Locked: given or already solved correctly

    if (state.isNotesMode) {
      // Toggle note
      const currentNotes = new Set(state.notes[idx]);
      if (currentNotes.has(num)) {
        currentNotes.delete(num);
      } else {
        currentNotes.add(num);
      }
      pushHistory({ type: 'notes', cell: idx, prev: new Set(state.notes[idx]), next: currentNotes });
      state.notes[idx] = currentNotes;
      SoundManager.playNote();
      updateBoardValues();
    } else {
      // Enter Digit
      const prevVal = state.board[idx];
      const correctVal = state.puzzle.solution[idx];
      const isCorrect = (num === correctVal);

      if (isCorrect) {
        // ĐIỀN ĐÚNG: Khóa cố định ô, phát âm thanh chuẩn, tự chuyển ô tiếp theo
        pushHistory({
          type: 'digit',
          cell: idx,
          prevVal: prevVal,
          nextVal: num,
          prevNotes: new Set(state.notes[idx])
        });

        state.board[idx] = num;
        state.notes[idx].clear();
        state.lockedCells.add(idx); // Khóa vĩnh viễn ô này
        state.conflicts.delete(idx);
        SoundManager.playPlace();

        // Auto remove notes in same row/col/box/cage
        if (state.autoRemoveNotes) {
          removeConflictingNotes(idx, num);
        }

        updateBoardValues();

        // Hiệu ứng ăn điểm / điền đúng
        const cellEl = dom.board.children[idx];
        if (cellEl) {
          cellEl.classList.add('correct-pop');
          setTimeout(() => cellEl.classList.remove('correct-pop'), 400);
        }

        updateHighlights();
        updateCageInspector();
        updateNumpadCounts();

        // Đồng bộ tiến độ PvP nếu đang trong trận
        if (window.KillerSudokuPvP && window.KillerSudokuPvP.isInMatch()) {
          let solved = 0;
          for (let i = 0; i < 81; i++) {
            if (state.board[i] === state.puzzle.solution[i]) solved++;
          }
          const pct = Math.floor((solved / 81) * 100);
          window.KillerSudokuPvP.reportProgress(solved, pct);
        }

        checkWinCondition();

        // Tự động chuyển con trỏ sang ô trống tiếp theo
        autoAdvance(idx);
      } else {
        // ĐIỀN SAI: Báo lỗi, rung ô, chớp đỏ 500ms và tự xóa, KHÔNG lưu số sai vào bàn cờ
        state.mistakes++;
        updateMistakesDisplay();
        SoundManager.playError();

        // Đồng bộ lỗi PvP nếu đang trong trận
        if (window.KillerSudokuPvP && window.KillerSudokuPvP.isInMatch()) {
          window.KillerSudokuPvP.reportMistake(state.mistakes);
        }

        const cellEl = dom.board.children[idx];
        if (cellEl) {
          let digitSpan = cellEl.querySelector('.cell-digit');
          let created = false;
          if (!digitSpan) {
            digitSpan = document.createElement('span');
            digitSpan.className = 'cell-digit';
            cellEl.appendChild(digitSpan);
            created = true;
          }
          digitSpan.textContent = num;
          cellEl.classList.add('error', 'shake');

          setTimeout(() => {
            cellEl.classList.remove('error', 'shake');
            if (created && digitSpan.parentNode === cellEl) {
              digitSpan.remove();
            } else if (!created) {
              digitSpan.textContent = '';
            }
            updateBoardValues();
          }, 500);
        }

        if (state.mistakeLimit && state.mistakes >= state.maxMistakes) {
          setTimeout(() => {
            if (window.KillerSudokuPvP && window.KillerSudokuPvP.isInMatch()) {
              // Trong PvP sẽ xử lý thua trận
              window.KillerSudokuPvP.reportMistake(state.mistakes);
            } else {
              alert('Bạn đã phạm quá 3 lỗi! Hãy thử lại màn chơi này nhé.');
              loadLevel(state.difficulty, state.puzzleIndex);
            }
          }, 550);
          return;
        }
      }
    }
  }

  function autoAdvance(currIdx) {
    for (let step = 1; step < 81; step++) {
      const nextIdx = (currIdx + step) % 81;
      if (!state.lockedCells.has(nextIdx) && state.board[nextIdx] === 0) {
        selectCell(nextIdx);
        break;
      }
    }
  }

  function removeConflictingNotes(cellIdx, num) {
    const row = Math.floor(cellIdx / 9);
    const col = cellIdx % 9;
    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;
    const cage = state.puzzle.cages[cellIdx];

    for (let i = 0; i < 81; i++) {
      if (i === cellIdx) continue;
      const r = Math.floor(i / 9);
      const c = i % 9;
      const sameBox = Math.floor(r / 3) * 3 === boxRow && Math.floor(c / 3) * 3 === boxCol;
      const sameCage = state.puzzle.cages[i] === cage;

      if (r === row || c === col || sameBox || sameCage) {
        state.notes[i].delete(num);
      }
    }
  }

  function eraseSelected() {
    if (state.isComplete || state.isPaused) return;
    const idx = state.selectedCell;
    if (idx < 0 || idx >= 81) return;
    if (state.lockedCells && state.lockedCells.has(idx)) {
      // Đã giải đúng hoặc là số cho sẵn: TUYỆT ĐỐI KHÔNG CHO PHÉP XÓA
      SoundManager.playClick();
      return;
    }

    const prevVal = state.board[idx];
    const prevNotes = new Set(state.notes[idx]);

    if (prevVal === 0 && prevNotes.size === 0) return;

    pushHistory({ type: 'erase', cell: idx, prevVal, prevNotes });
    state.board[idx] = 0;
    state.notes[idx].clear();
    state.conflicts.delete(idx);

    SoundManager.playErase();
    updateBoardValues();
    updateHighlights();
    updateCageInspector();
    updateNumpadCounts();
  }

  function toggleNotesMode() {
    state.isNotesMode = !state.isNotesMode;
    if (dom.notesBadge) {
      dom.notesBadge.textContent = state.isNotesMode ? 'ON' : 'OFF';
      dom.notesBadge.classList.toggle('on', state.isNotesMode);
    }
    SoundManager.playClick();
  }

  function undoAction() {
    if (state.isComplete || state.isPaused || state.history.length === 0) return;
    const action = state.history.pop();
    state.redoStack.push(action);

    if (action.type === 'digit') {
      state.board[action.cell] = action.prevVal;
      state.notes[action.cell] = action.prevNotes;
      state.conflicts.delete(action.cell);
    } else if (action.type === 'notes') {
      state.notes[action.cell] = action.prev;
    } else if (action.type === 'erase') {
      state.board[action.cell] = action.prevVal;
      state.notes[action.cell] = action.prevNotes;
    }

    SoundManager.playUndo();
    updateBoardValues();
    updateHighlights();
    updateCageInspector();
    updateNumpadCounts();
  }

  function pushHistory(record) {
    state.history.push(record);
    state.redoStack = [];
    if (state.history.length > 50) state.history.shift();
  }

  function giveSmartHint() {
    if (state.isComplete || state.isPaused) return;

    // Prioritize selected cell if empty
    let target = state.selectedCell;
    if (state.board[target] !== 0) {
      target = state.board.findIndex(v => v === 0);
    }
    if (target === -1) return;

    const correct = state.puzzle.solution[target];
    pushHistory({
      type: 'digit',
      cell: target,
      prevVal: state.board[target],
      nextVal: correct,
      prevNotes: new Set(state.notes[target])
    });

    state.board[target] = correct;
    state.lockedCells.add(target); // Khóa ô gợi ý lại
    state.notes[target].clear();
    state.conflicts.delete(target);
    selectCell(target);

    if (state.autoRemoveNotes) {
      removeConflictingNotes(target, correct);
    }

    SoundManager.playFanfare();
    updateBoardValues();

    const cellEl = dom.board.children[target];
    if (cellEl) {
      cellEl.classList.add('correct-pop');
      setTimeout(() => cellEl.classList.remove('correct-pop'), 400);
    }

    updateHighlights();
    updateCageInspector();
    updateNumpadCounts();
    checkWinCondition();
  }

  function fillAutoNotes() {
    for (let i = 0; i < 81; i++) {
      if (state.board[i] === 0) {
        state.notes[i] = KillerEngine.getCandidates(state.board, state.puzzle, i);
      }
    }
    SoundManager.playNote();
    updateBoardValues();
  }

  function togglePause() {
    state.isPaused = !state.isPaused;
    if (dom.pauseOverlay) {
      dom.pauseOverlay.classList.toggle('hidden', !state.isPaused);
    }
    SoundManager.playClick();
  }

  function startTimer(reset = false) {
    if (reset) state.timerSeconds = 0;
    if (state.timerInterval) clearInterval(state.timerInterval);

    state.timerInterval = setInterval(() => {
      if (!state.isPaused && !state.isComplete) {
        state.timerSeconds++;
        const mins = String(Math.floor(state.timerSeconds / 60)).padStart(2, '0');
        const secs = String(state.timerSeconds % 60).padStart(2, '0');
        dom.timerDisplay.textContent = `${mins}:${secs}`;
      }
    }, 1000);
  }

  function checkWinCondition() {
    for (let i = 0; i < 81; i++) {
      if (state.board[i] !== state.puzzle.solution[i]) return;
    }
    state.isComplete = true;
    SoundManager.playFanfare();

    // Nếu đang trong trận PvP -> Báo cáo hoàn thành tới WebSocket server
    if (window.KillerSudokuPvP && window.KillerSudokuPvP.isInMatch()) {
      window.KillerSudokuPvP.reportFinished(state.timerSeconds);
      return;
    }

    // Show Win Modal (Single player)
    dom.winTime.textContent = dom.timerDisplay.textContent;
    dom.winMistakes.textContent = `${state.mistakes}/${state.maxMistakes}`;
    dom.winScore.textContent = Number(state.allTimeScore + 100).toLocaleString('en-US');
    state.allTimeScore += 100;
    dom.allTimeScoreDisplay.textContent = Number(state.allTimeScore).toLocaleString('en-US');

    recordSolvedProgress(state.difficulty, state.puzzle?.id || (state.puzzleIndex + 1), state.timerSeconds, state.mistakes);

    setTimeout(() => {
      dom.winModal.classList.remove('hidden');
    }, 400);
  }

  function handleKeyboard(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    const key = e.key;
    if (key >= '1' && key <= '9') {
      handleNumberInput(parseInt(key, 10));
      return;
    }
    if (key === 'Backspace' || key === 'Delete') {
      eraseSelected();
      return;
    }
    if (key.toLowerCase() === 'n') {
      toggleNotesMode();
      return;
    }
    if (key.toLowerCase() === 'u' || (e.ctrlKey && key.toLowerCase() === 'z')) {
      e.preventDefault();
      undoAction();
      return;
    }
    if (key.toLowerCase() === 'h') {
      giveSmartHint();
      return;
    }
    if (key === ' ') {
      e.preventDefault();
      togglePause();
      return;
    }

    // Arrow navigation
    const r = Math.floor(state.selectedCell / 9);
    const c = state.selectedCell % 9;
    if (key === 'ArrowUp' || key.toLowerCase() === 'w') {
      if (r > 0) selectCell((r - 1) * 9 + c);
    } else if (key === 'ArrowDown' || key.toLowerCase() === 's') {
      if (r < 8) selectCell((r + 1) * 9 + c);
    } else if (key === 'ArrowLeft' || key.toLowerCase() === 'a') {
      if (c > 0) selectCell(r * 9 + (c - 1));
    } else if (key === 'ArrowRight' || key.toLowerCase() === 'd') {
      if (c < 8) selectCell(r * 9 + (c + 1));
    }
  }

  // Modals & Navigation
  
  function getAuthToken() {
    try {
      const queryToken = new URLSearchParams(window.location.search).get('token');
      if (queryToken) return queryToken;
      return localStorage.getItem('bdu_token') ||
             sessionStorage.getItem('bdu_token') ||
             (window.parent && window.parent.localStorage ? window.parent.localStorage.getItem('bdu_token') : null) ||
             (window.parent && window.parent.sessionStorage ? window.parent.sessionStorage.getItem('bdu_token') : null);
    } catch (e) {
      return null;
    }
  }

  async function fetchSolvedProgress() {
    const token = getAuthToken();
    try {
      const localData = JSON.parse(localStorage.getItem('killer_sudoku_progress') || '{}');
      if (localData && typeof localData === 'object') {
        state.solvedProgress = { ...localData };
      }
    } catch (e) {}

    if (!token) return;

    try {
      const res = await fetch('/api/games/killer-sudoku/progress', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const json = await res.json();
        if (json.result && json.data?.solvedByDifficulty) {
          state.solvedProgress = { ...state.solvedProgress, ...json.data.solvedByDifficulty };
          try {
            localStorage.setItem('killer_sudoku_progress', JSON.stringify(state.solvedProgress));
          } catch (e) {}
        }
      }
    } catch (e) {
      console.warn('Lỗi tải tiến độ giải màn:', e);
    }
  }

  async function recordSolvedProgress(diff, levelId, timeSeconds, mistakes) {
    const d = String(diff || 'easy').toLowerCase();
    const lvl = String(levelId || '1');
    if (!state.solvedProgress[d]) state.solvedProgress[d] = {};
    const prev = state.solvedProgress[d][lvl];
    state.solvedProgress[d][lvl] = {
      bestTimeSeconds: prev ? Math.min(prev.bestTimeSeconds || timeSeconds, timeSeconds) : timeSeconds,
      mistakes: prev ? Math.min(prev.mistakes ?? mistakes, mistakes) : mistakes,
      solveCount: (prev?.solveCount || 0) + 1,
      completedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem('killer_sudoku_progress', JSON.stringify(state.solvedProgress));
    } catch (e) {}

    if (dom.winProgressSaved) {
      dom.winProgressSaved.classList.remove('hidden');
    }

    const token = getAuthToken();
    if (!token) return;

    try {
      await fetch('/api/games/killer-sudoku/progress', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          difficulty: d,
          levelId: lvl,
          timeSeconds,
          mistakes
        })
      });
    } catch (e) {
      console.warn('Lỗi lưu tiến độ lên máy chủ:', e);
    }
  }

  function openLevelPicker() {
    dom.pickerModal.classList.remove('hidden');
    fetchSolvedProgress().then(() => renderLevelGrid(state.difficulty));
    renderLevelGrid(state.difficulty);
    SoundManager.playClick();
  }

  function closeLevelPicker() {
    dom.pickerModal.classList.add('hidden');
  }

  function renderLevelGrid(diff = state.difficulty) {
    if (!window.KILLER_PUZZLES_RAW || !window.KILLER_PUZZLES_RAW[diff]) return;
    const pool = window.KILLER_PUZZLES_RAW[diff];
    dom.pickerGrid.innerHTML = '';

    dom.diffTabs.forEach(t => t.classList.toggle('active', t.dataset.diff === diff));

    const solvedForDiff = (state.solvedProgress && state.solvedProgress[diff.toLowerCase()]) || {};

    // Display levels in grid
    const limit = Math.min(pool.length, 300);
    for (let i = 0; i < limit; i++) {
      const btn = document.createElement('button');
      btn.className = 'lvl-btn';
      const parts = pool[i].split(';');
      const lvlId = parts[0];

      const solvedInfo = solvedForDiff[lvlId];
      if (solvedInfo) {
        btn.classList.add('solved');
        const bestTime = solvedInfo.bestTimeSeconds;
        let timeStr = '';
        if (bestTime > 0) {
          const m = Math.floor(bestTime / 60);
          const s = bestTime % 60;
          timeStr = `${m}:${s < 10 ? '0' : ''}${s}`;
        }
        btn.innerHTML = `<span class="lvl-num">${lvlId}</span><span class="lvl-badge">✓</span>${timeStr ? `<span class="lvl-time">${timeStr}</span>` : ''}`;
        btn.title = `Đã giải xong${timeStr ? ` (Kỷ lục: ${timeStr})` : ''}`;
      } else {
        btn.textContent = lvlId;
      }

      if (diff === state.difficulty && i === state.puzzleIndex) {
        btn.classList.add('active');
      }
      btn.addEventListener('click', () => {
        closeLevelPicker();
        loadLevel(diff, i);
      });
      dom.pickerGrid.appendChild(btn);
    }
  }

  function openSettings() {
    dom.settingsModal.classList.remove('hidden');
    SoundManager.playClick();
  }

  function closeSettings() {
    dom.settingsModal.classList.add('hidden');
  }

  function loadPuzzleRaw(raw, diff = 'expert') {
    state.difficulty = diff;
    state.puzzleIndex = 0;
    state.puzzle = KillerEngine.parsePuzzle(raw);

    // Reset game state
    state.board = [...state.puzzle.givens];
    state.notes = Array.from({ length: 81 }, () => new Set());
    state.history = [];
    state.redoStack = [];
    state.selectedCell = state.puzzle.givens.findIndex(v => v === 0);
    if (state.selectedCell === -1) state.selectedCell = 0;
    state.mistakes = 0;
    state.hintsLeft = 0; // Không dùng gợi ý trong PvP
    state.isComplete = false;
    state.isPaused = false;
    state.conflicts = new Set();
    state.lockedCells = new Set();
    state.puzzle.givens.forEach((v, i) => {
      if (v > 0) state.lockedCells.add(i);
    });

    dom.levelTitle.textContent = state.puzzle.id || 'PvP';
    dom.diffDisplay.textContent = formatDiffName(diff);
    if (dom.hintBadge) dom.hintBadge.textContent = '0';
    updateMistakesDisplay();

    renderBoard();
    updateHighlights();
    updateCageInspector();
    updateNumpadCounts();
    startTimer(true);
  }

  function loadDefaultLevel() {
    loadLevel(state.difficulty, state.puzzleIndex);
  }

  // Export public interface for PvP / External scripts
  window.KillerSudokuApp = {
    loadPuzzleRaw,
    loadDefaultLevel,
    getState: () => state
  };

  // Start app on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

