/**
 * Killer Sudoku - Dual Calculator Module
 * 1. Standard Pocket Calculator (Máy tính cầm tay thông thường)
 * 2. Killer Sudoku Combinations Helper (Đề xuất tổ hợp ô chuồng)
 */

(function () {
  'use strict';

  // ==========================================
  // TAB SWITCHING LOGIC
  // ==========================================
  function initTabs() {
    const tabBtns = document.querySelectorAll('.calc-tab-btn');
    const tabPanes = document.querySelectorAll('.calc-tab-pane');

    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab');
        tabBtns.forEach((b) => b.classList.remove('active'));
        tabPanes.forEach((p) => p.classList.remove('active'));

        btn.classList.add('active');
        const activePane = document.getElementById(target);
        if (activePane) activePane.classList.add('active');
      });
    });
  }

  // ==========================================
  // 1. STANDARD CALCULATOR LOGIC
  // ==========================================
  const stdCalc = {
    previousOperand: '',
    currentOperand: '0',
    operation: undefined,
    shouldResetScreen: false,

    clear() {
      this.currentOperand = '0';
      this.previousOperand = '';
      this.operation = undefined;
      this.shouldResetScreen = false;
      this.updateDisplay();
    },

    delete() {
      if (this.shouldResetScreen) {
        this.currentOperand = '0';
        this.shouldResetScreen = false;
      } else {
        this.currentOperand = this.currentOperand.toString().slice(0, -1);
        if (this.currentOperand === '' || this.currentOperand === '-') {
          this.currentOperand = '0';
        }
      }
      this.updateDisplay();
    },

    appendNumber(number) {
      if (this.shouldResetScreen) {
        this.currentOperand = '';
        this.shouldResetScreen = false;
      }
      if (number === '.' && this.currentOperand.includes('.')) return;
      if (this.currentOperand === '0' && number !== '.') {
        this.currentOperand = number.toString();
      } else {
        this.currentOperand = this.currentOperand.toString() + number.toString();
      }
      this.updateDisplay();
    },

    toggleSign() {
      if (this.currentOperand === '0') return;
      this.currentOperand = (parseFloat(this.currentOperand) * -1).toString();
      this.updateDisplay();
    },

    percentage() {
      const current = parseFloat(this.currentOperand);
      if (isNaN(current)) return;
      this.currentOperand = (current / 100).toString();
      this.updateDisplay();
    },

    chooseOperation(operation) {
      if (this.currentOperand === '') return;
      if (this.previousOperand !== '') {
        this.compute();
      }
      this.operation = operation;
      this.previousOperand = this.currentOperand;
      this.shouldResetScreen = true;
      this.updateDisplay();
    },

    compute() {
      let computation;
      const prev = parseFloat(this.previousOperand);
      const current = parseFloat(this.currentOperand);
      if (isNaN(prev) || isNaN(current)) return;

      switch (this.operation) {
        case '+':
          computation = prev + current;
          break;
        case '-':
        case '−':
          computation = prev - current;
          break;
        case '×':
        case '*':
          computation = prev * current;
          break;
        case '÷':
        case '/':
          if (current === 0) {
            this.currentOperand = 'Lỗi chia 0';
            this.previousOperand = '';
            this.operation = undefined;
            this.shouldResetScreen = true;
            this.updateDisplay();
            return;
          }
          computation = prev / current;
          break;
        default:
          return;
      }

      // Làm tròn để tránh lỗi số thực ví dụ 0.1 + 0.2 = 0.30000000000000004
      computation = Math.round(computation * 100000000) / 100000000;
      this.currentOperand = computation.toString();
      this.previousOperand = '';
      this.operation = undefined;
      this.shouldResetScreen = true;
      this.updateDisplay();
    },

    updateDisplay() {
      const currentElem = document.getElementById('stdCurrentOperand');
      const prevElem = document.getElementById('stdPreviousOperand');
      if (currentElem) currentElem.innerText = this.currentOperand;
      if (prevElem) {
        if (this.operation != null) {
          prevElem.innerText = `${this.previousOperand} ${this.operation}`;
        } else {
          prevElem.innerText = '';
        }
      }
    }
  };

  function initStandardCalculator() {
    const calcElement = document.getElementById('tabStandardCalc');
    if (!calcElement) return;

    calcElement.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      const num = btn.getAttribute('data-num');
      const action = btn.getAttribute('data-action');

      if (num !== null) {
        stdCalc.appendNumber(num);
      } else if (action) {
        switch (action) {
          case 'clear':
            stdCalc.clear();
            break;
          case 'delete':
            stdCalc.delete();
            break;
          case 'toggle-sign':
            stdCalc.toggleSign();
            break;
          case 'percent':
            stdCalc.percentage();
            break;
          case 'add':
            stdCalc.chooseOperation('+');
            break;
          case 'subtract':
            stdCalc.chooseOperation('−');
            break;
          case 'multiply':
            stdCalc.chooseOperation('×');
            break;
          case 'divide':
            stdCalc.chooseOperation('÷');
            break;
          case 'equals':
            stdCalc.compute();
            break;
        }
      }
    });
  }

  // ==========================================
  // 2. KILLER SUDOKU COMBINATIONS HELPER
  // ==========================================
  const MIN_SUM = { 1: 1, 2: 3, 3: 6, 4: 10, 5: 15, 6: 21, 7: 28 };
  const MAX_SUM = { 1: 9, 2: 17, 3: 24, 4: 30, 5: 35, 6: 39, 7: 42 };

  let currentCageSize = 2;
  let currentTargetSum = 16;
  let currentExistingDigits = [];

  function calculateCombinations(size, sum) {
    const results = [];
    function backtrack(start, combo, currentSum) {
      if (combo.length === size) {
        if (currentSum === sum) results.push([...combo]);
        return;
      }
      for (let digit = start; digit <= 9; digit++) {
        if (currentSum + digit > sum) break;
        const remainingSlots = size - combo.length - 1;
        const minPossibleRemain = (remainingSlots * (2 * (digit + 1) + remainingSlots - 1)) / 2;
        if (currentSum + digit + minPossibleRemain > sum) break;

        combo.push(digit);
        backtrack(digit + 1, combo, currentSum + digit);
        combo.pop();
      }
    }
    backtrack(1, [], 0);
    return results;
  }

  function updateCombinationsUI() {
    const minS = MIN_SUM[currentCageSize] || 3;
    const maxS = MAX_SUM[currentCageSize] || 17;

    // Validate bounds
    if (currentTargetSum < minS) currentTargetSum = minS;
    if (currentTargetSum > maxS) currentTargetSum = maxS;

    // Update label & inputs
    const rangeLabel = document.getElementById('comboRangeLabel');
    const sumInput = document.getElementById('comboSumInput');
    const sumSlider = document.getElementById('comboSumSlider');

    if (rangeLabel) rangeLabel.textContent = `(Hợp lệ: ${minS} – ${maxS})`;
    if (sumInput) {
      sumInput.value = currentTargetSum;
      sumInput.min = minS;
      sumInput.max = maxS;
    }
    if (sumSlider) {
      sumSlider.value = currentTargetSum;
      sumSlider.min = minS;
      sumSlider.max = maxS;
    }

    // Calculate combinations
    const rawCombos = calculateCombinations(currentCageSize, currentTargetSum);

    // Sort combos: matching combos on top
    const combos = [...rawCombos].sort((a, b) => {
      const aMatches = currentExistingDigits.length > 0 && currentExistingDigits.every((d) => a.includes(d));
      const bMatches = currentExistingDigits.length > 0 && currentExistingDigits.every((d) => b.includes(d));
      if (aMatches && !bMatches) return -1;
      if (!aMatches && bMatches) return 1;
      return 0;
    });

    const countBadge = document.getElementById('comboCountBadge');
    if (countBadge) {
      countBadge.textContent = `${combos.length} tổ hợp`;
    }

    // Forced digits (chữ số xuất hiện trong TẤT CẢ các tổ hợp)
    const forcedBox = document.getElementById('comboForcedBox');
    const forcedText = document.getElementById('comboForcedDigits');
    if (combos.length > 0) {
      const forced = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) =>
        combos.every((combo) => combo.includes(d))
      );
      if (forced.length > 0 && forcedBox && forcedText) {
        forcedBox.classList.remove('hidden');
        forcedText.textContent = forced.join(', ');
      } else if (forcedBox) {
        forcedBox.classList.add('hidden');
      }
    } else if (forcedBox) {
      forcedBox.classList.add('hidden');
    }

    // List of combinations
    const listWrap = document.getElementById('comboListWrap');
    if (listWrap) {
      listWrap.innerHTML = '';
      if (combos.length === 0) {
        listWrap.innerHTML = '<div class="combo-empty">Không có tổ hợp số hợp lệ!</div>';
      } else {
        combos.forEach((combo) => {
          const isMatching = currentExistingDigits.length > 0 && currentExistingDigits.every((d) => combo.includes(d));
          const hasConflict = currentExistingDigits.some((d) => !combo.includes(d));

          const item = document.createElement('div');
          item.className = 'combo-item-chip';
          if (isMatching) {
            item.classList.add('highlight');
            item.innerHTML = `
              <span class="combo-digits">${combo.join(' + ')} <span class="combo-match-badge">Khớp ô ✓</span></span>
              <span class="combo-eq">= ${currentTargetSum}</span>
            `;
          } else {
            if (currentExistingDigits.length > 0 && hasConflict) {
              item.style.opacity = '0.45';
            }
            item.innerHTML = `<span class="combo-digits">${combo.join(' + ')}</span> <span class="combo-eq">= ${currentTargetSum}</span>`;
          }
          listWrap.appendChild(item);
        });
      }
    }
  }

  // Global API to auto sync with clicked cage on Sudoku Board
  window.KillerCombinations = {
    setCage(size, sum, existingDigits = [], autoSwitchTab = true) {
      if (!size || size < 1 || size > 7) return;
      currentCageSize = size;
      currentTargetSum = sum;
      currentExistingDigits = existingDigits || [];

      // Update pills
      const sizePills = document.querySelectorAll('.combo-size-pill');
      sizePills.forEach((p) => {
        const s = parseInt(p.getAttribute('data-size'), 10);
        p.classList.toggle('active', s === currentCageSize);
      });

      updateCombinationsUI();

      if (autoSwitchTab) {
        this.switchToTab();
      }
    },
    switchToTab() {
      const tabBtns = document.querySelectorAll('.calc-tab-btn');
      const tabPanes = document.querySelectorAll('.calc-tab-pane');
      tabBtns.forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === 'tabCombinations'));
      tabPanes.forEach((p) => p.classList.toggle('active', p.id === 'tabCombinations'));
    }
  };

  function initCombinationsHelper() {
    // Size pills
    const sizePills = document.querySelectorAll('.combo-size-pill');
    sizePills.forEach((pill) => {
      pill.addEventListener('click', () => {
        sizePills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        currentCageSize = parseInt(pill.getAttribute('data-size'), 10) || 2;
        updateCombinationsUI();
      });
    });

    // Sum buttons
    const btnMinus = document.getElementById('btnComboMinus');
    const btnPlus = document.getElementById('btnComboPlus');
    const sumInput = document.getElementById('comboSumInput');
    const sumSlider = document.getElementById('comboSumSlider');

    if (btnMinus) {
      btnMinus.addEventListener('click', () => {
        currentTargetSum--;
        updateCombinationsUI();
      });
    }

    if (btnPlus) {
      btnPlus.addEventListener('click', () => {
        currentTargetSum++;
        updateCombinationsUI();
      });
    }

    if (sumInput) {
      sumInput.addEventListener('change', () => {
        currentTargetSum = parseInt(sumInput.value, 10) || 10;
        updateCombinationsUI();
      });
    }

    if (sumSlider) {
      sumSlider.addEventListener('input', () => {
        currentTargetSum = parseInt(sumSlider.value, 10) || 10;
        updateCombinationsUI();
      });
    }

    // Quick presets
    const presetChips = document.querySelectorAll('.preset-cage-chip');
    presetChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const size = parseInt(chip.getAttribute('data-size'), 10);
        const sum = parseInt(chip.getAttribute('data-sum'), 10);
        if (size && sum) {
          currentCageSize = size;
          currentTargetSum = sum;
          sizePills.forEach((p) => {
            if (parseInt(p.getAttribute('data-size'), 10) === size) {
              p.classList.add('active');
            } else {
              p.classList.remove('active');
            }
          });
          updateCombinationsUI();
        }
      });
    });

    updateCombinationsUI();
  }

  // ==========================================
  // INITIALIZE ALL
  // ==========================================
  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initStandardCalculator();
    initCombinationsHelper();
  });
})();
