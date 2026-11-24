/**
 * Mathematical Formula -> Office Math Markup Language (OMML, ECMA-376 §22.1)
 *
 * Converts plain-text / Unicode / LaTeX standalone mathematical formulas into
 * native Microsoft Word equations (<m:oMathPara><m:oMath>...</m:oMath></m:oMathPara>)
 * rendered with Cambria Math: real stacked fractions (<m:f>), large N-ary
 * summations/products/integrals (<m:nary>), math accents (<m:acc>), radicals
 * (<m:rad>), subscripts/superscripts (<m:sSub>, <m:sSup>, <m:sSubSup>),
 * under-limits (<m:limLow>), and auto-scaling delimiters (<m:d>).
 */

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const UNICODE_SUB_MAP = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '−', '₌': '=', '₍': '(', '₎': ')',
  'ₐ': 'a', 'ₑ': 'e', 'ₕ': 'h', 'ᵢ': 'i', 'ⱼ': 'j',
  'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n', 'ₒ': 'o',
  'ₚ': 'p', 'ᵣ': 'r', 'ₛ': 's', 'ₜ': 't', 'ᵤ': 'u',
  'ᵥ': 'v', 'ₓ': 'x', 'ᵦ': 'β', 'ᵧ': 'γ', 'ᵨ': 'ρ',
  'ᵩ': 'φ', 'ᵪ': 'χ'
};

const UNICODE_SUP_MAP = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '−', '⁼': '=', '⁽': '(', '⁾': ')',
  'ⁿ': 'n', 'ⁱ': 'i', 'ᵀ': 'T', '⊤': '⊤'
};

const LATEX_SYMBOLS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  nabla: '∇', partial: '∂', infty: '∞',
  pm: '±', mp: '∓', times: '×', cdot: '⋅', div: '÷', ast: '∗', star: '⋆',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
  approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', propto: '∝',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
  cup: '∪', cap: '∩', emptyset: '∅', forall: '∀', exists: '∃',
  to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
  leftrightarrow: '↔', Leftrightarrow: '⇔', mapsto: '↦',
  top: '⊤', bot: '⊥', perp: '⊥', parallel: '∥',
  dots: '…', ldots: '…', cdots: '⋯'
};

const LATEX_ACCENTS = {
  hat: '\u0302', widehat: '\u0302',
  tilde: '\u0303', widetilde: '\u0303',
  bar: '\u0304', overline: '\u0305',
  vec: '\u20D7', overrightarrow: '\u20D7',
  dot: '\u0307', ddot: '\u0308'
};

const COMBINING_ACCENT_SET = new Set(['\u0302', '\u0303', '\u0304', '\u0305', '\u0307', '\u0308', '\u20D7']);

const LIM_FUNCTIONS = new Set(['lim', 'argmin', 'argmax', 'min', 'max', 'sup', 'inf']);

const STD_FUNCTIONS = new Set([
  'exp', 'ln', 'log', 'log2', 'log10',
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan',
  'softmax', 'sigmoid', 'sgn', 'sign', 'diag', 'tr', 'det', 'rank'
]);

const UPRIGHT_ACRONYMS = new Set([
  'MSE', 'RMSE', 'MAE', 'MAPE', 'SMAPE', 'SSE', 'SST', 'SSR',
  'BCE', 'CE', 'OLS', 'WLS', 'GLS', 'KL', 'JS', 'IoU', 'GIoU',
  'ROC', 'AUC', 'PR', 'AP', 'mAP', 'TP', 'FP', 'FN', 'TN', 'TPR', 'FPR',
  'AIC', 'BIC', 'ELBO', 'MLP', 'CNN', 'RNN', 'LSTM', 'GRU',
  'SGD', 'Adam', 'ReLU', 'LeakyReLU', 'GELU', 'SiLU', 'Swish',
  'Var', 'Cov', 'Corr', 'Std', 'SE', 'Bias', 'Pr',
  'Ridge', 'Lasso', 'OvR', 'OvO', 'TF', 'IDF', 'BM25',
  'new', 'old', 'pred', 'true', 'init', 'train', 'test', 'val', 'loss', 'macro', 'micro', 'total'
]);

const RELATION_OPS = new Set([
  '=', '≠', '≈', '≃', '≡', '≤', '≥', '<', '>', '≪', '≫',
  '∈', '∉', '⊂', '⊆', '⊃', '⊇', '→', '←', '⇒', '⇐', '↔', '⇔', '↦', '∼', '∝', ':'
]);

const ADDITIVE_OPS = new Set(['+', '−', '±', '∓']);
const MULT_OPS = new Set(['⋅', '×', '÷', '∗', '∘', '⊗', '⊕', '⊙']);

const VI_DIACRITIC_RE = /[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]/iu;

const MATH_RPR_FONTS = '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:cs="Cambria Math"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr>';
const TEXT_RPR_FONTS = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr>';

function ommlMathRun(text, style = null) {
  const mRPr = style ? `<m:rPr><m:sty m:val="${style}"/></m:rPr>` : '';
  return `<m:r>${mRPr}${MATH_RPR_FONTS}<m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
}

function ommlNormalTextRun(text) {
  return `<m:r><m:rPr><m:nor/></m:rPr>${TEXT_RPR_FONTS}<m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
}

/**
 * Extract structured formula source from a paragraph's <w:r> children,
 * converting Word <w:vertAlign w:val="subscript|superscript"/> runs into
 * explicit _{...} / ^{...} groups and isolating any trailing tab equation number.
 */
export function extractParagraphMathSource($, paragraph) {
  const parts = [];
  for (const node of $(paragraph).contents().toArray()) {
    if (node.name === 'w:pPr' || node.name === 'w:bookmarkStart' || node.name === 'w:bookmarkEnd'
        || node.name === 'w:commentRangeStart' || node.name === 'w:commentRangeEnd') continue;
    if (node.name === 'w:tab') {
      parts.push({ kind: 'tab', text: '\t' });
      continue;
    }
    if (node.name === 'w:r') {
      const r = $(node);
      if (r.children('w\\:tab').length && !r.children('w\\:t').length) {
        parts.push({ kind: 'tab', text: '\t' });
        continue;
      }
      const vert = r.children('w\\:rPr').children('w\\:vertAlign').attr('w:val') || '';
      const txt = r.children('w\\:t').toArray().map(t => $(t).text()).join('');
      if (!txt) continue;
      if (vert === 'subscript') parts.push({ kind: 'sub', text: txt });
      else if (vert === 'superscript') parts.push({ kind: 'sup', text: txt });
      else parts.push({ kind: 'text', text: txt });
    }
  }

  let equationNumber = '';
  // Detect trailing "\t (1.1)" or "\t [2-1]" equation number
  let endIdx = parts.length;
  while (endIdx > 0 && parts[endIdx - 1].kind === 'text' && !parts[endIdx - 1].text.trim()) endIdx--;
  if (endIdx >= 2 && parts[endIdx - 1].kind === 'text'
      && /^\s*[\(\[]\d+(?:[.\-]\d+)*[\)\]]\s*$/.test(parts[endIdx - 1].text)
      && parts[endIdx - 2].kind === 'tab') {
    equationNumber = parts[endIdx - 1].text.trim();
    endIdx -= 2;
  }

  // Strip leading formatting tab if present
  let startIdx = 0;
  if (startIdx < endIdx && parts[startIdx].kind === 'tab') startIdx++;

  let raw = '';
  for (let i = startIdx; i < endIdx; i++) {
    const item = parts[i];
    if (item.kind === 'tab') raw += '    ';
    else if (item.kind === 'sub') raw += `_{${item.text}}`;
    else if (item.kind === 'sup') raw += `^{${item.text}}`;
    else raw += item.text;
  }

  raw = raw.trim();
  if (/^\$\$[\s\S]+\$\$$/.test(raw)) raw = raw.slice(2, -2).trim();
  else if (/^\\\[[\s\S]+\\\]$/.test(raw)) raw = raw.slice(2, -2).trim();

  return { formulaSource: raw, equationNumber };
}

/**
 * Split a line that contains multiple side-by-side equations separated by wide
 * whitespace (e.g., "ŷᵢ = b + wᵀxᵢ    MSE = (1/n) Σᵢ (yᵢ − ŷᵢ)²").
 */
export function splitFormulaSegments(source) {
  const s = String(source || '').trim();
  if (!s) return [];
  const segments = [];
  let depth = 0;
  let barOpen = false;
  let last = 0;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if ((ch === ')' || ch === ']' || ch === '}') && depth > 0) depth--;
    else if (ch === '|') barOpen = !barOpen;

    if (depth === 0 && !barOpen && (ch === ' ' || ch === '\t')) {
      let j = i;
      let width = 0;
      while (j < s.length && (s[j] === ' ' || s[j] === '\t')) {
        width += s[j] === '\t' ? 4 : 1;
        j++;
      }
      if (width >= 3) {
        const left = s.slice(last, i).trim();
        const right = s.slice(j).trim();
        if (left && right) {
          segments.push(left);
          last = j;
          i = j - 1;
          continue;
        }
      }
      i = j - 1;
    }
  }
  const tail = s.slice(last).trim();
  if (tail) segments.push(tail);
  return segments;
}

function tryDecomposeSingleMathAccent(token) {
  if (!token) return null;
  const nfd = token.normalize('NFD');
  const codePoints = [...nfd];
  if (codePoints.length === 2 && /\p{L}/u.test(codePoints[0]) && COMBINING_ACCENT_SET.has(codePoints[1])) {
    return { base: codePoints[0], accent: codePoints[1] };
  }
  return null;
}

export function tokenizeMath(input) {
  const tokens = [];
  const s = String(input || '');
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Contiguous Unicode subscript characters
    if (UNICODE_SUB_MAP[ch] !== undefined) {
      let buf = '';
      while (i < s.length && UNICODE_SUB_MAP[s[i]] !== undefined) {
        buf += UNICODE_SUB_MAP[s[i++]];
      }
      tokens.push({ type: 'UNI_SUB', value: buf });
      continue;
    }

    // Contiguous Unicode superscript characters
    if (UNICODE_SUP_MAP[ch] !== undefined) {
      let buf = '';
      while (i < s.length && UNICODE_SUP_MAP[s[i]] !== undefined) {
        buf += UNICODE_SUP_MAP[s[i++]];
      }
      tokens.push({ type: 'UNI_SUP', value: buf });
      continue;
    }

    // LaTeX commands
    if (ch === '\\') {
      if (s[i + 1] === '|') {
        tokens.push({ type: 'NORM_DELIM', value: '‖' });
        i += 2;
        continue;
      }
      if (s[i + 1] === '{' || s[i + 1] === '}') {
        tokens.push({ type: 'BRACE_LITERAL', value: s[i + 1] });
        i += 2;
        continue;
      }
      if (s[i + 1] === ',' || s[i + 1] === ';' || s[i + 1] === ':' || s[i + 1] === '!') {
        i += 2;
        continue;
      }
      const m = s.slice(i + 1).match(/^[a-zA-Z]+/);
      if (m) {
        const cmd = m[0];
        i += 1 + cmd.length;
        if (cmd === 'left' || cmd === 'right' || cmd === 'displaystyle' || cmd === 'textstyle') continue;
        if (cmd === 'quad' || cmd === 'qquad') {
          tokens.push({ type: 'TEXT', value: '  ' });
          continue;
        }
        if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
          tokens.push({ type: 'LATEX_FRAC' });
          continue;
        }
        if (cmd === 'sqrt') {
          tokens.push({ type: 'SQRT' });
          continue;
        }
        if (cmd === 'sum' || cmd === 'Sigma' && (s[i] === '_' || s[i] === '^')) {
          tokens.push({ type: 'NARY', value: '∑' });
          continue;
        }
        if (cmd === 'prod') {
          tokens.push({ type: 'NARY', value: '∏' });
          continue;
        }
        if (cmd === 'int' || cmd === 'iint' || cmd === 'oint') {
          tokens.push({ type: 'NARY', value: cmd === 'iint' ? '∬' : cmd === 'oint' ? '∮' : '∫' });
          continue;
        }
        if (LATEX_ACCENTS[cmd]) {
          tokens.push({ type: 'LATEX_ACC', value: LATEX_ACCENTS[cmd] });
          continue;
        }
        if (cmd === 'text' || cmd === 'textrm' || cmd === 'mathrm' || cmd === 'operatorname') {
          tokens.push({ type: 'LATEX_TEXT_CMD', mode: cmd === 'text' || cmd === 'textrm' ? 'text' : 'upright' });
          continue;
        }
        if (cmd === 'mathbf' || cmd === 'boldsymbol') {
          tokens.push({ type: 'LATEX_BOLD_CMD' });
          continue;
        }
        if (LIM_FUNCTIONS.has(cmd)) {
          tokens.push({ type: 'LIM_FUNC', value: cmd });
          continue;
        }
        if (STD_FUNCTIONS.has(cmd)) {
          tokens.push({ type: 'FUNC', value: cmd });
          continue;
        }
        if (LATEX_SYMBOLS[cmd]) {
          const sym = LATEX_SYMBOLS[cmd];
          if (RELATION_OPS.has(sym)) tokens.push({ type: 'REL', value: sym });
          else if (ADDITIVE_OPS.has(sym)) tokens.push({ type: 'ADD', value: sym });
          else if (MULT_OPS.has(sym)) tokens.push({ type: 'MULT', value: sym });
          else tokens.push({ type: 'VAR', value: sym });
          continue;
        }
        tokens.push({ type: 'UPRIGHT', value: cmd });
        continue;
      }
      i++;
      continue;
    }

    // Multi-character ASCII operators
    if (s.startsWith('||', i) || ch === '‖') {
      tokens.push({ type: 'NORM_DELIM', value: '‖' });
      i += ch === '‖' ? 1 : 2;
      continue;
    }
    if (s.startsWith('<=', i)) { tokens.push({ type: 'REL', value: '≤' }); i += 2; continue; }
    if (s.startsWith('>=', i)) { tokens.push({ type: 'REL', value: '≥' }); i += 2; continue; }
    if (s.startsWith('!=', i)) { tokens.push({ type: 'REL', value: '≠' }); i += 2; continue; }
    if (s.startsWith('->', i)) { tokens.push({ type: 'REL', value: '→' }); i += 2; continue; }
    if (s.startsWith('=>', i)) { tokens.push({ type: 'REL', value: '⇒' }); i += 2; continue; }
    if (s.startsWith('...', i)) { tokens.push({ type: 'VAR', value: '…' }); i += 3; continue; }

    // Subscript / Superscript operators
    if (ch === '_') { tokens.push({ type: 'SUB_OP' }); i++; continue; }
    if (ch === '^') { tokens.push({ type: 'SUP_OP' }); i++; continue; }

    // N-ary & Radical symbols
    if (ch === '∑' || ch === '∏' || ch === '∫' || ch === '∬' || ch === '∮') {
      tokens.push({ type: 'NARY', value: ch });
      i++;
      continue;
    }
    if (ch === 'Σ') {
      // Distinguish summation Σ from standalone covariance matrix Σ
      const rest = s.slice(i + 1).trim();
      const isMatrixVar = !rest || /^[=+\-−),\]};]/.test(rest) || (rest.startsWith('⁻') || rest.startsWith('^'));
      tokens.push(isMatrixVar ? { type: 'VAR', value: 'Σ' } : { type: 'NARY', value: '∑' });
      i++;
      continue;
    }
    if (ch === '√') {
      tokens.push({ type: 'SQRT' });
      i++;
      continue;
    }

    // Delimiters & Grouping
    if (ch === '(' || ch === ')' || ch === '[' || ch === ']') {
      tokens.push({ type: 'DELIM', value: ch });
      i++;
      continue;
    }
    if (ch === '{' || ch === '}') {
      // If preceded by _ / ^ / LaTeX command, it's a structural group; otherwise literal set brace (e.g. {0, 1})
      const prev = tokens.at(-1);
      const isGroupOpen = ch === '{' && prev && ['SUB_OP', 'SUP_OP', 'LATEX_FRAC', 'SQRT', 'LATEX_ACC', 'LATEX_TEXT_CMD', 'LATEX_BOLD_CMD', 'GROUP_CLOSE'].includes(prev.type);
      tokens.push({ type: ch === '{' ? (isGroupOpen ? 'GROUP_OPEN' : 'BRACE_OPEN') : 'BRACE_OR_GROUP_CLOSE', value: ch });
      i++;
      continue;
    }
    if (ch === '|') {
      tokens.push({ type: 'BAR', value: '|' });
      i++;
      continue;
    }

    // Fraction slash
    if (ch === '/') {
      tokens.push({ type: 'SLASH' });
      i++;
      continue;
    }

    // Operators & Punctuation
    if (ch === '-' || ch === '−' || ch === '–') {
      tokens.push({ type: 'ADD', value: '−' });
      i++;
      continue;
    }
    if (ADDITIVE_OPS.has(ch)) {
      tokens.push({ type: 'ADD', value: ch });
      i++;
      continue;
    }
    if (ch === '*') {
      tokens.push({ type: 'MULT', value: '⋅' });
      i++;
      continue;
    }
    if (MULT_OPS.has(ch)) {
      tokens.push({ type: 'MULT', value: ch });
      i++;
      continue;
    }
    if (RELATION_OPS.has(ch)) {
      tokens.push({ type: 'REL', value: ch });
      i++;
      continue;
    }
    if (ch === ',' || ch === ';') {
      tokens.push({ type: 'PUNCT', value: ch });
      i++;
      continue;
    }
    if (ch === '\'' || ch === '′') {
      tokens.push({ type: 'PRIME', value: '′' });
      i++;
      continue;
    }

    // Numbers (including decimals like 0,5 or 2.50 when surrounded by digits -> keep exact separator)
    const numMatch = s.slice(i).match(/^\d+(?:[.,]\d+)?/);
    if (numMatch) {
      tokens.push({ type: 'NUM', value: numMatch[0] });
      i += numMatch[0].length;
      continue;
    }

    // Words / Identifiers / Variables (excluding Unicode sub/superscript modifier letters & summation Σ)
    const isWordChar = c => Boolean(c) && UNICODE_SUB_MAP[c] === undefined && UNICODE_SUP_MAP[c] === undefined && c !== 'Σ' && /[\p{L}\p{M}]/u.test(c);
    if (isWordChar(ch)) {
      let end = i;
      while (end < s.length && isWordChar(s[end])) end++;
      while (end < s.length && /\d/.test(s[end])) end++;
      let word = s.slice(i, end);
      // Check if single base letter + combining accent followed by more letters (e.g. X̃X -> split X̃ first!)
      const firstGrapheme = word.match(/^\p{L}\p{M}+/u)?.[0];
      if (firstGrapheme && firstGrapheme.length < word.length) {
        const decomposedFirst = tryDecomposeSingleMathAccent(firstGrapheme);
        if (decomposedFirst) {
          tokens.push({ type: 'ACCENTED_VAR', base: decomposedFirst.base, accent: decomposedFirst.accent });
          i += firstGrapheme.length;
          continue;
        }
      }

      // Check single accented math variable (e.g. ŷ, X̃, x̄, θ̂)
      const singleAcc = tryDecomposeSingleMathAccent(word);
      if (singleAcc) {
        tokens.push({ type: 'ACCENTED_VAR', base: singleAcc.base, accent: singleAcc.accent });
        i += word.length;
        continue;
      }

      i += word.length;

      // Label like "Ridge:" or "Lasso:" at start of segment
      if (tokens.length === 0 && s[i] === ':') {
        i++;
        tokens.push({ type: 'LABEL', value: `${word}: ` });
        continue;
      }

      if (LIM_FUNCTIONS.has(word)) {
        tokens.push({ type: 'LIM_FUNC', value: word });
        continue;
      }
      if (STD_FUNCTIONS.has(word)) {
        tokens.push({ type: 'FUNC', value: word });
        continue;
      }
      if (UPRIGHT_ACRONYMS.has(word)) {
        // E.g. R2 stays R^2 if written R², while F1 stays upright F1
        tokens.push({ type: 'UPRIGHT', value: word });
        continue;
      }
      if ([...word].length >= 2 && VI_DIACRITIC_RE.test(word)) {
        tokens.push({ type: 'VI_TEXT', value: word });
        continue;
      }

      // Split trailing digits on single-letter math variable like z1, x2, L1, L2 -> Subscript!
      const varDigit = word.match(/^(\p{L})(\d+)$/u);
      if (varDigit) {
        tokens.push({ type: 'VAR', value: varDigit[1] });
        tokens.push({ type: 'UNI_SUB', value: varDigit[2] });
        continue;
      }

      tokens.push({ type: 'VAR', value: word });
      continue;
    }

    // Any other math/Unicode symbol (∇, ∂, ∞, %, !, etc.)
    tokens.push({ type: 'SYM', value: ch });
    i++;
  }

  return tokens;
}

function unwrapOuterParens(node) {
  if (node && node.kind === 'delim' && node.open === '(' && node.close === ')') {
    return node.body;
  }
  if (node && node.kind === 'group') {
    return node.body;
  }
  return [node];
}

function isSimpleFractionFactor(node) {
  if (!node) return false;
  if (node.kind === 'delim' || node.kind === 'group') return false;
  return ['num', 'var', 'upright', 'acc', 'sub', 'sup', 'subsup', 'func', 'rad'].includes(node.kind);
}

export function parseMathTokens(tokens) {
  let pos = 0;
  const peek = (offset = 0) => tokens[pos + offset] || null;
  const consume = () => tokens[pos++] || null;

  function parseSequence(stopCheck) {
    const items = [];
    while (pos < tokens.length && (!stopCheck || !stopCheck(peek()))) {
      const t = peek();
      if (t.type === 'LABEL') {
        consume();
        items.push({ kind: 'text', value: t.value });
        continue;
      }
      if (t.type === 'REL') {
        consume();
        items.push({ kind: 'rel', value: t.value });
        continue;
      }
      if (t.type === 'PUNCT') {
        consume();
        items.push({ kind: 'punct', value: t.value });
        continue;
      }
      const addNodes = parseAdditive(stopCheck);
      if (!addNodes.length) {
        // Safety progress guarantee so parser can never infinite-loop
        const stray = consume();
        if (stray) items.push({ kind: 'sym', value: stray.value || '' });
      } else {
        items.push(...addNodes);
      }
    }
    return items;
  }

  function isTermStop(t, stopCheck) {
    if (!t) return true;
    if (stopCheck && stopCheck(t)) return true;
    return t.type === 'REL' || t.type === 'PUNCT';
  }

  function parseAdditive(stopCheck) {
    const out = [];
    while (pos < tokens.length && !isTermStop(peek(), stopCheck)) {
      if (peek().type === 'ADD') {
        const op = consume();
        out.push({ kind: 'op', value: op.value });
        continue;
      }
      const term = parseMultiplicativeTerm(stopCheck);
      if (!term.length) break;
      out.push(...term);
      if (peek() && peek().type === 'ADD' && !(stopCheck && stopCheck(peek()))) {
        out.push({ kind: 'op', value: consume().value });
      } else {
        break;
      }
    }
    return out;
  }

  function parseMultiplicativeTerm(stopCheck) {
    const factors = [];
    while (pos < tokens.length && !isTermStop(peek(), stopCheck) && peek().type !== 'ADD') {
      if (peek().type === 'SLASH') {
        consume();
        // Build numerator from preceding factors in this multiplicative term
        const numRaw = factors.length ? factors.splice(0, factors.length) : [{ kind: 'num', value: '1' }];
        const num = numRaw.length === 1 ? unwrapOuterParens(numRaw[0]) : numRaw;

        // Parse denominator:
        // - If next starts with N-ary (e.g. "/ Σⱼ exp(zⱼ)"), N-ary consumes its summand
        // - If next is parenthesized/grouped (e.g. "/ (1 + exp(-z))" or "/ (2n)"), consume that group + any exponent
        // - If next is simple factor(s) like "/ 2n" or "/ SST", consume tight simple factors, stopping before |...| or [...]
        const denFactors = [];
        const firstDen = parsePrefixFactor(stopCheck);
        if (firstDen) {
          denFactors.push(firstDen);
          if (isSimpleFractionFactor(firstDen) && firstDen.kind !== 'func') {
            while (pos < tokens.length && !isTermStop(peek(), stopCheck) && peek().type !== 'ADD' && peek().type !== 'SLASH') {
              const nt = peek();
              if (nt.type === 'BAR' || nt.type === 'NORM_DELIM' || nt.type === 'DELIM' || nt.type === 'NARY'
                  || nt.type === 'VI_TEXT' || nt.type === 'FUNC' || nt.type === 'LIM_FUNC') break;
              const nextFactor = parsePrefixFactor(stopCheck);
              if (!nextFactor) break;
              denFactors.push(nextFactor);
            }
          }
        }
        const den = denFactors.length === 1
          ? unwrapOuterParens(denFactors[0])
          : (denFactors.length ? denFactors : [{ kind: 'var', value: '?' }]);

        factors.push({ kind: 'frac', num, den });
        continue;
      }

      if (peek().type === 'MULT') {
        factors.push({ kind: 'op', value: consume().value });
        continue;
      }

      const factor = parsePrefixFactor(stopCheck);
      if (!factor) break;
      // Unwrap standalone (a/b) factor (when not raised to a power!) so "(1/n) Σᵢ" -> "1/n Σᵢ" cleanly
      if (factor.kind === 'delim' && factor.open === '(' && factor.close === ')'
          && factor.body.length === 1 && factor.body[0].kind === 'frac') {
        factors.push(factor.body[0]);
      } else {
        factors.push(factor);
      }
    }
    return factors;
  }

  function parseScriptArgument() {
    const t = peek();
    if (!t) return [];
    if (t.type === 'GROUP_OPEN' || t.type === 'BRACE_OPEN') {
      consume();
      const inner = parseSequence(tok => tok?.type === 'BRACE_OR_GROUP_CLOSE');
      if (peek()?.type === 'BRACE_OR_GROUP_CLOSE') consume();
      return inner;
    }
    if (t.type === 'DELIM' && t.value === '(') {
      consume();
      const inner = parseSequence(tok => tok?.type === 'DELIM' && tok.value === ')');
      if (peek()?.type === 'DELIM' && peek().value === ')') consume();
      return inner;
    }
    // Single primary atom (without eating subsequent _ or ^ at same level)
    let sign = null;
    if (t.type === 'ADD') sign = { kind: 'op', value: consume().value };
    const atom = parsePrimaryAtom();
    if (sign && atom) return [sign, atom];
    if (sign) return [sign];
    return atom ? [atom] : [];
  }

  function readOptionalSubSup() {
    let sub = null;
    let sup = null;
    while (pos < tokens.length) {
      const t = peek();
      if (t.type === 'UNI_SUB' && !sub) {
        consume();
        sub = parseMathTokens(tokenizeMath(t.value));
      } else if (t.type === 'UNI_SUP' && !sup) {
        consume();
        sup = parseMathTokens(tokenizeMath(t.value));
      } else if (t.type === 'SUB_OP' && !sub) {
        consume();
        sub = parseScriptArgument();
      } else if (t.type === 'SUP_OP' && !sup) {
        consume();
        sup = parseScriptArgument();
      } else if (t.type === 'PRIME') {
        consume();
        sup = sup ? [...sup, { kind: 'sym', value: '′' }] : [{ kind: 'sym', value: '′' }];
      } else {
        break;
      }
    }
    return { sub, sup };
  }

  function parsePrefixFactor(stopCheck) {
    const t = peek();
    if (!t) return null;

    // LaTeX \frac{num}{den}
    if (t.type === 'LATEX_FRAC') {
      consume();
      const num = parseScriptArgument();
      const den = parseScriptArgument();
      const fracNode = { kind: 'frac', num: num.length ? num : [{ kind: 'num', value: '1' }], den: den.length ? den : [{ kind: 'num', value: '1' }] };
      return attachScripts(fracNode);
    }

    // Radical: √x, √(a+b), \sqrt[n]{x}
    if (t.type === 'SQRT') {
      consume();
      let deg = null;
      if (peek()?.type === 'DELIM' && peek().value === '[') {
        consume();
        deg = parseSequence(tok => tok?.type === 'DELIM' && tok.value === ']');
        if (peek()?.type === 'DELIM' && peek().value === ']') consume();
      }
      const argAtom = parsePostfixFactor(stopCheck);
      const body = argAtom ? unwrapOuterParens(argAtom) : [{ kind: 'var', value: '' }];
      return attachScripts({ kind: 'rad', deg, body });
    }

    // N-ary operator: ∑, ∏, ∫
    if (t.type === 'NARY') {
      const chr = consume().value;
      const { sub, sup } = readOptionalSubSup();
      // Summand is the rest of the multiplicative term (stops at + / - / = / closing delim)
      const body = parseMultiplicativeTerm(stopCheck);
      return { kind: 'nary', chr, sub, sup, body: body.length ? body : [{ kind: 'var', value: '' }] };
    }

    // Limit-capable function: argmax_k, argmin_k, lim_{n->infty}, max_k, min_w
    if (t.type === 'LIM_FUNC') {
      const name = consume().value;
      const { sub, sup } = readOptionalSubSup();
      return { kind: 'limfunc', name, sub, sup };
    }

    // Standard upright math function: exp, ln, log, sin, cos...
    if (t.type === 'FUNC') {
      const name = consume().value;
      const { sub, sup } = readOptionalSubSup();
      let arg = null;
      if (peek()?.type === 'DELIM' && peek().value === '(') {
        arg = parsePostfixFactor(stopCheck);
      }
      return { kind: 'func', name, sub, sup, arg };
    }

    // LaTeX accent: \hat{y}, \tilde{X}, \bar{x}, \vec{v}
    if (t.type === 'LATEX_ACC') {
      const accent = consume().value;
      const base = parseScriptArgument();
      return attachScripts({ kind: 'acc', accent, base: base.length ? base : [{ kind: 'var', value: '' }] });
    }

    if (t.type === 'LATEX_TEXT_CMD') {
      const mode = consume().mode;
      const inner = parseScriptArgument();
      const rawText = inner.map(n => n.value || '').join('');
      return attachScripts(mode === 'text' ? { kind: 'text', value: rawText } : { kind: 'upright', value: rawText });
    }

    if (t.type === 'LATEX_BOLD_CMD') {
      consume();
      const inner = parseScriptArgument();
      const rawText = inner.map(n => n.value || '').join('');
      return attachScripts({ kind: 'bold', value: rawText });
    }

    return parsePostfixFactor(stopCheck);
  }

  function attachScripts(baseNode) {
    if (!baseNode) return null;
    const { sub, sup } = readOptionalSubSup();
    if (sub && sup) return { kind: 'subsup', base: baseNode, sub, sup };
    if (sub) return { kind: 'sub', base: baseNode, sub };
    if (sup) return { kind: 'sup', base: baseNode, sup };
    return baseNode;
  }

  function parsePostfixFactor(stopCheck) {
    const base = parsePrimaryAtom(stopCheck);
    return attachScripts(base);
  }

  function parsePrimaryAtom() {
    const t = peek();
    if (!t) return null;

    if (t.type === 'DELIM' && (t.value === '(' || t.value === '[')) {
      const open = consume().value;
      const expectedClose = open === '(' ? ')' : ']';
      const body = parseSequence(tok => tok?.type === 'DELIM' && tok.value === expectedClose);
      const close = (peek()?.type === 'DELIM' && peek().value === expectedClose) ? consume().value : expectedClose;
      return { kind: 'delim', open, close, body };
    }

    if (t.type === 'GROUP_OPEN') {
      consume();
      const body = parseSequence(tok => tok?.type === 'BRACE_OR_GROUP_CLOSE');
      if (peek()?.type === 'BRACE_OR_GROUP_CLOSE') consume();
      return { kind: 'group', body };
    }

    if (t.type === 'BRACE_OPEN') {
      consume();
      const body = parseSequence(tok => tok?.type === 'BRACE_OR_GROUP_CLOSE');
      if (peek()?.type === 'BRACE_OR_GROUP_CLOSE') consume();
      return { kind: 'delim', open: '{', close: '}', body };
    }

    if (t.type === 'BAR') {
      consume();
      const body = parseSequence(tok => tok?.type === 'BAR');
      if (peek()?.type === 'BAR') consume();
      return { kind: 'delim', open: '|', close: '|', body };
    }

    if (t.type === 'NORM_DELIM') {
      consume();
      const body = parseSequence(tok => tok?.type === 'NORM_DELIM');
      if (peek()?.type === 'NORM_DELIM') consume();
      return { kind: 'delim', open: '‖', close: '‖', body };
    }

    if (t.type === 'ACCENTED_VAR') {
      consume();
      return { kind: 'acc', accent: t.accent, base: [{ kind: 'var', value: t.base }] };
    }

    if (t.type === 'NUM') {
      return { kind: 'num', value: consume().value };
    }

    if (t.type === 'UPRIGHT') {
      return { kind: 'upright', value: consume().value };
    }

    if (t.type === 'VI_TEXT') {
      return { kind: 'vitext', value: consume().value };
    }

    if (t.type === 'VAR') {
      return { kind: 'var', value: consume().value };
    }

    if (t.type === 'BRACE_LITERAL' || t.type === 'SYM') {
      return { kind: 'sym', value: consume().value };
    }

    return null;
  }

  return parseSequence(null);
}

function ensureNonEmptyOmmlArg(xml) {
  return xml || ommlMathRun('');
}

function renderSupNodes(supNodes, ctx) {
  // Render matrix transpose T in upright Roman when standalone exponent
  if (supNodes.length === 1 && supNodes[0].kind === 'var' && supNodes[0].value === 'T') {
    return ommlMathRun('T', 'p');
  }
  return ensureNonEmptyOmmlArg(renderAstNodes(supNodes, { ...ctx, compact: true }));
}

export function renderAstNodes(nodes, ctx = { compact: false }) {
  let xml = '';
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const prev = i > 0 ? nodes[i - 1] : null;
    const next = i + 1 < nodes.length ? nodes[i + 1] : null;

    if (node.kind === 'vitext') {
      const leadSpace = prev && !['delim', 'group'].includes(prev.kind) ? ' ' : '';
      const trailSpace = next && next.kind === 'vitext' ? '' : (next && ['var', 'acc', 'num', 'upright', 'nary', 'rad', 'func'].includes(next.kind) ? ' ' : '');
      xml += ommlNormalTextRun(`${leadSpace}${node.value}${trailSpace}`);
      continue;
    }

    if (node.kind === 'text') {
      xml += ommlNormalTextRun(node.value);
      continue;
    }

    if (node.kind === 'num') {
      xml += ommlMathRun(node.value, 'p');
      continue;
    }

    if (node.kind === 'upright') {
      xml += ommlMathRun(node.value, 'p');
      continue;
    }

    if (node.kind === 'bold') {
      xml += ommlMathRun(node.value, 'b');
      continue;
    }

    if (node.kind === 'var') {
      xml += ommlMathRun(node.value, null);
      continue;
    }

    if (node.kind === 'rel' || node.kind === 'op' || node.kind === 'punct' || node.kind === 'sym') {
      const text = node.kind === 'punct' ? `${node.value} ` : node.value;
      xml += ommlMathRun(text, 'p');
      continue;
    }

    if (node.kind === 'group') {
      xml += renderAstNodes(node.body, ctx);
      continue;
    }

    if (node.kind === 'acc') {
      const baseXml = ensureNonEmptyOmmlArg(renderAstNodes(node.base, ctx));
      xml += `<m:acc><m:accPr><m:chr m:val="${esc(node.accent)}"/></m:accPr><m:e>${baseXml}</m:e></m:acc>`;
      continue;
    }

    if (node.kind === 'sub') {
      const baseXml = ensureNonEmptyOmmlArg(renderAstNodes([node.base], ctx));
      const subXml = ensureNonEmptyOmmlArg(renderAstNodes(node.sub, { ...ctx, compact: true }));
      xml += `<m:sSub><m:e>${baseXml}</m:e><m:sub>${subXml}</m:sub></m:sSub>`;
      continue;
    }

    if (node.kind === 'sup') {
      const baseXml = ensureNonEmptyOmmlArg(renderAstNodes([node.base], ctx));
      const supXml = renderSupNodes(node.sup, ctx);
      xml += `<m:sSup><m:e>${baseXml}</m:e><m:sup>${supXml}</m:sup></m:sSup>`;
      continue;
    }

    if (node.kind === 'subsup') {
      const baseXml = ensureNonEmptyOmmlArg(renderAstNodes([node.base], ctx));
      const subXml = ensureNonEmptyOmmlArg(renderAstNodes(node.sub, { ...ctx, compact: true }));
      const supXml = renderSupNodes(node.sup, ctx);
      xml += `<m:sSubSup><m:e>${baseXml}</m:e><m:sub>${subXml}</m:sub><m:sup>${supXml}</m:sup></m:sSubSup>`;
      continue;
    }

    if (node.kind === 'frac') {
      const numXml = ensureNonEmptyOmmlArg(renderAstNodes(node.num, { ...ctx, compact: true }));
      const denXml = ensureNonEmptyOmmlArg(renderAstNodes(node.den, { ...ctx, compact: true }));
      xml += `<m:f><m:fPr><m:type m:val="bar"/></m:fPr><m:num>${numXml}</m:num><m:den>${denXml}</m:den></m:f>`;
      continue;
    }

    if (node.kind === 'rad') {
      const bodyXml = ensureNonEmptyOmmlArg(renderAstNodes(node.body, { ...ctx, compact: true }));
      if (node.deg && node.deg.length) {
        const degXml = ensureNonEmptyOmmlArg(renderAstNodes(node.deg, { ...ctx, compact: true }));
        xml += `<m:rad><m:radPr><m:degHide m:val="0"/></m:radPr><m:deg>${degXml}</m:deg><m:e>${bodyXml}</m:e></m:rad>`;
      } else {
        xml += `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${bodyXml}</m:e></m:rad>`;
      }
      continue;
    }

    if (node.kind === 'nary') {
      const limLoc = ctx.compact ? 'subSup' : 'undOvr';
      const hasSub = Boolean(node.sub && node.sub.length);
      const hasSup = Boolean(node.sup && node.sup.length);
      const subXml = hasSub ? renderAstNodes(node.sub, { ...ctx, compact: true }) : '';
      const supXml = hasSup ? renderAstNodes(node.sup, { ...ctx, compact: true }) : '';
      const bodyXml = ensureNonEmptyOmmlArg(renderAstNodes(node.body, ctx));
      // Strict ECMA-376 CT_NaryPr child order: chr -> limLoc -> grow -> subHide -> supHide
      const naryPr = `<m:naryPr><m:chr m:val="${esc(node.chr)}"/><m:limLoc m:val="${limLoc}"/><m:grow m:val="1"/>${hasSub ? '' : '<m:subHide m:val="1"/>'}${hasSup ? '' : '<m:supHide m:val="1"/>'}</m:naryPr>`;
      xml += `<m:nary>${naryPr}<m:sub>${subXml}</m:sub><m:sup>${supXml}</m:sup><m:e>${bodyXml}</m:e></m:nary>`;
      continue;
    }

    if (node.kind === 'limfunc') {
      const fnXml = ommlMathRun(node.name, 'p');
      if (node.sub && node.sub.length) {
        const limXml = ensureNonEmptyOmmlArg(renderAstNodes(node.sub, { ...ctx, compact: true }));
        if (ctx.compact) {
          xml += `<m:sSub><m:e>${fnXml}</m:e><m:sub>${limXml}</m:sub></m:sSub>`;
        } else {
          xml += `<m:limLow><m:e>${fnXml}</m:e><m:lim>${limXml}</m:lim></m:limLow>`;
        }
      } else {
        xml += fnXml;
      }
      if (next && !['delim', 'rel', 'op', 'punct'].includes(next.kind)) {
        xml += ommlNormalTextRun('\u2009');
      }
      continue;
    }

    if (node.kind === 'func') {
      let fnNodeXml = ommlMathRun(node.name, 'p');
      if (node.sub && node.sup) {
        fnNodeXml = `<m:sSubSup><m:e>${fnNodeXml}</m:e><m:sub>${ensureNonEmptyOmmlArg(renderAstNodes(node.sub, { ...ctx, compact: true }))}</m:sub><m:sup>${renderSupNodes(node.sup, ctx)}</m:sup></m:sSubSup>`;
      } else if (node.sub) {
        fnNodeXml = `<m:sSub><m:e>${fnNodeXml}</m:e><m:sub>${ensureNonEmptyOmmlArg(renderAstNodes(node.sub, { ...ctx, compact: true }))}</m:sub></m:sSub>`;
      } else if (node.sup) {
        fnNodeXml = `<m:sSup><m:e>${fnNodeXml}</m:e><m:sup>${renderSupNodes(node.sup, ctx)}</m:sup></m:sSup>`;
      }
      xml += fnNodeXml;
      if (node.arg) {
        xml += renderAstNodes([node.arg], ctx);
      } else if (next && !['delim', 'rel', 'op', 'punct'].includes(next.kind)) {
        xml += ommlNormalTextRun('\u2009');
      }
      continue;
    }

    if (node.kind === 'delim') {
      const innerXml = ensureNonEmptyOmmlArg(renderAstNodes(node.body, ctx));
      // Strict ECMA-376 CT_DPr child order: begChr -> endChr -> grow
      xml += `<m:d><m:dPr><m:begChr m:val="${esc(node.open)}"/><m:endChr m:val="${esc(node.close)}"/><m:grow m:val="1"/></m:dPr><m:e>${innerXml}</m:e></m:d>`;
      continue;
    }
  }
  return xml;
}

/**
 * Compile a formula string into inner <m:oMath>...</m:oMath> XML.
 * Multi-formula lines separated by wide spaces are joined by a 2-em quad space.
 */
export function formulaToOmml(formulaSource) {
  const segments = splitFormulaSegments(formulaSource);
  if (!segments.length) return '';
  const renderedSegments = segments.map(segment => {
    const tokens = tokenizeMath(segment);
    if (!tokens.length) return '';
    const ast = parseMathTokens(tokens);
    return renderAstNodes(ast, { compact: false });
  }).filter(Boolean);

  if (!renderedSegments.length) return '';
  const quadSeparator = ommlNormalTextRun('\u2003\u2003');
  return `<m:oMath>${renderedSegments.join(quadSeparator)}</m:oMath>`;
}

/**
 * Upgrade a plain-text / Unicode / LaTeX equation paragraph (<w:p>) in-place
 * into a native Word OMML equation while preserving bookmarks and comments.
 * Leaves paragraphs that already contain native <m:oMath> / <m:oMathPara> untouched.
 */
export function upgradeEquationParagraphToOmml($, paragraph) {
  const p = $(paragraph);
  if (p.find('m\\:oMathPara, m\\:oMath').length > 0) return false;
  if (p.find('w\\:drawing, w\\:pict, w\\:object, w\\:fldChar, w\\:fldSimple').length > 0) return false;

  const { formulaSource, equationNumber } = extractParagraphMathSource($, paragraph);
  if (!formulaSource) return false;

  const oMathXml = formulaToOmml(formulaSource);
  if (!oMathXml) return false;

  // Preserve paragraph properties, bookmarks, and comment anchors
  const preservedNodes = p.contents().toArray().filter(node =>
    ['w:pPr', 'w:bookmarkStart', 'w:bookmarkEnd', 'w:commentRangeStart', 'w:commentRangeEnd'].includes(node.name)
    || (node.name === 'w:r' && $(node).children('w\\:commentReference').length > 0)
  );
  const commentRefs = preservedNodes.filter(node => node.name === 'w:r');
  const leadingMeta = preservedNodes.filter(node => node.name !== 'w:r').map(node => $.xml(node)).join('');
  const trailingComments = commentRefs.map(node => $.xml(node)).join('');

  if (equationNumber) {
    // Centered OMML equation at 4536 dxa + flush-right equation number at 9071 dxa
    const eqNumRun = `<w:r>${TEXT_RPR_FONTS}<w:t>${esc(equationNumber)}</w:t></w:r>`;
    p.html(`${leadingMeta}<w:r><w:tab/></w:r>${oMathXml}<w:r><w:tab/></w:r>${eqNumRun}${trailingComments}`);
    return { upgraded: true, numbered: true };
  }

  const oMathParaXml = `<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${oMathXml}</m:oMathPara>`;
  p.html(`${leadingMeta}${oMathParaXml}${trailingComments}`);
  return { upgraded: true, numbered: false };
}
