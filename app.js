(function() {
  'use strict';

  const leftInput = document.getElementById('left-input');
  const rightInput = document.getElementById('right-input');
  const btnDiff = document.getElementById('btn-diff');
  const btnShare = document.getElementById('btn-share');
  const btnClear = document.getElementById('btn-clear');
  const btnSwap = document.getElementById('btn-swap');
  const diffOutput = document.getElementById('diff-output');
  const leftPane = document.getElementById('left-pane');
  const rightPane = document.getElementById('right-pane');
  const leftStats = document.getElementById('left-stats');
  const rightStats = document.getElementById('right-stats');
  const loading = document.getElementById('loading');

  const optTrimWhitespace = document.getElementById('opt-trim-whitespace');
  const optIgnoreCase = document.getElementById('opt-ignore-case');
  const optIgnoreWhitespace = document.getElementById('opt-ignore-whitespace');
  const optWordDiff = document.getElementById('opt-word-diff');
  const optShowUnchanged = document.getElementById('opt-show-unchanged');
  const optLineNumbers = document.getElementById('opt-line-numbers');
  const optWrapLines = document.getElementById('opt-wrap-lines');
  const optAutoDiff = document.getElementById('opt-auto-diff');
  const optDiffMode = document.getElementById('opt-diff-mode');

  let currentDiffData = null;
  let autoDiffTimer = null;
  let isLoadingFromHash = false;
  let diffWorker = null;
  let renderChunkTimer = null;
  let visibleLineRange = { start: 0, end: 0 };
  let allDiffLines = { left: [], right: [] };

  const STORAGE_KEY = 'diff-tool-options';
  const MAX_TOKENS_FAST_PATH = 50000;
  const RENDER_CHUNK_SIZE = 500;
  const VIRTUALIZATION_THRESHOLD = 2000;

  function loadOptions() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const opts = JSON.parse(stored);
        optTrimWhitespace.checked = opts.trimWhitespace ?? true;
        optIgnoreCase.checked = opts.ignoreCase ?? false;
        optIgnoreWhitespace.checked = opts.ignoreWhitespace ?? false;
        optWordDiff.checked = opts.wordDiff ?? true;
        optShowUnchanged.checked = opts.showUnchanged ?? true;
        optLineNumbers.checked = opts.lineNumbers ?? true;
        optWrapLines.checked = opts.wrapLines ?? true;
        optAutoDiff.checked = opts.autoDiff ?? false;
        optDiffMode.value = opts.diffMode || 'side-by-side';
      }
    } catch (e) {
      console.warn('Failed to load options:', e);
    }
  }

  function saveOptions() {
    try {
      const opts = {
        trimWhitespace: optTrimWhitespace.checked,
        ignoreCase: optIgnoreCase.checked,
        ignoreWhitespace: optIgnoreWhitespace.checked,
        wordDiff: optWordDiff.checked,
        showUnchanged: optShowUnchanged.checked,
        lineNumbers: optLineNumbers.checked,
        wrapLines: optWrapLines.checked,
        autoDiff: optAutoDiff.checked,
        diffMode: optDiffMode.value
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
    } catch (e) {
      console.warn('Failed to save options:', e);
    }
  }

  function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 200);
    }, 3000);
  }

  function normalizeText(text, options) {
    if (options.trimWhitespace) {
      text = text.trim();
    }
    if (options.ignoreCase) {
      text = text.toLowerCase();
    }
    if (options.ignoreWhitespace) {
      text = text.replace(/\s+/g, ' ');
    }
    return text;
  }

  function tokenize(text, wordLevel) {
    if (wordLevel) {
      return text.split(/(\s+)/).filter(t => t.length > 0);
    }
    return text.split('');
  }

  function myersDiff(oldTokens, newTokens) {
    const n = oldTokens.length;
    const m = newTokens.length;
    const maxD = n + m;
    const vp = new Array(2 * maxD + 1);
    const vn = new Array(2 * maxD + 1);
    const offset = maxD;

    const trace = [];

    for (let d = 0; d <= maxD; d++) {
      const v = (d % 2 === 0) ? vp : vn;
      const prevV = (d % 2 === 0) ? vn : vp;

      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && prevV[offset + k - 1] < prevV[offset + k + 1])) {
          x = prevV[offset + k + 1];
        } else {
          x = prevV[offset + k - 1] + 1;
        }

        let y = x - k;

        while (x < n && y < m && oldTokens[x] === newTokens[y]) {
          x++;
          y++;
        }

        v[offset + k] = x;

        if (x >= n && y >= m) {
          return backtrack(oldTokens, newTokens, trace, n, m, d);
        }
      }
      trace.push(v.slice());
    }

    return backtrack(oldTokens, newTokens, trace, n, m, maxD);
  }

  function backtrack(oldTokens, newTokens, trace, n, m, d) {
    const result = [];
    let x = n, y = m;

    for (let i = trace.length - 1; i >= 0; i--) {
      const v = trace[i];
      const offset = n + m;
      const k = x - y;
      const prevK = (k === -i || (k !== i && v[offset + k - 1] < v[offset + k + 1])) ? k + 1 : k - 1;
      const prevX = v[offset + prevK];
      const prevY = prevX - prevK;

      while (x > prevX && y > prevY) {
        result.unshift({ type: 'equal', value: oldTokens[x - 1] });
        x--; y--;
      }

      if (x > prevX) {
        result.unshift({ type: 'removed', value: oldTokens[x - 1] });
        x--;
      } else if (y > prevY) {
        result.unshift({ type: 'added', value: newTokens[y - 1] });
        y--;
      }
    }

    return result;
  }

  function diffTokens(oldTokens, newTokens) {
    const totalTokens = oldTokens.length + newTokens.length;
    if (totalTokens > MAX_TOKENS_FAST_PATH) {
      return diffTokensChunked(oldTokens, newTokens);
    }
    return myersDiff(oldTokens, newTokens);
  }

  function diffTokensChunked(oldTokens, newTokens) {
    const chunkSize = 10000;
    const result = [];

    for (let i = 0; i < oldTokens.length; i += chunkSize) {
      const oldChunk = oldTokens.slice(i, i + chunkSize);
      const newChunk = newTokens.slice(i, i + chunkSize);
      const chunkDiff = myersDiff(oldChunk, newChunk);
      result.push(...chunkDiff);
    }

    return result;
  }

  function buildDiffLines(diff, options) {
    const showUnchanged = options.showUnchanged;
    const lines = { left: [], right: [] };
    let currentLine = { left: [], right: [] };
    let lineNum = 1;

    function flushLine() {
      if (currentLine.left.length === 0 && currentLine.right.length === 0) return;

      lines.left.push({
        num: lineNum,
        tokens: currentLine.left,
        hasChanges: currentLine.left.some(t => t.type !== 'equal') || currentLine.right.some(t => t.type !== 'equal')
      });
      lines.right.push({
        num: lineNum,
        tokens: currentLine.right,
        hasChanges: currentLine.left.some(t => t.type !== 'equal') || currentLine.right.some(t => t.type !== 'equal')
      });

      lineNum++;
      currentLine = { left: [], right: [] };
    }

    diff.forEach(token => {
      if (token.value === '\n' || token.value === '\r') {
        flushLine();
        return;
      }

      const shouldShow = showUnchanged || token.type !== 'equal';
      if (!shouldShow) return;

      const leftType = token.type === 'added' ? 'equal' : token.type;
      const rightType = token.type === 'removed' ? 'equal' : token.type;

      currentLine.left.push({ type: leftType, value: token.value });
      currentLine.right.push({ type: rightType, value: token.value });

      if (token.value.includes('\n')) {
        const parts = token.value.split('\n');
        parts.forEach((part, idx) => {
          if (idx > 0) {
            flushLine();
            if (part.length > 0) {
              currentLine.left.push({ type: leftType, value: part });
              currentLine.right.push({ type: rightType, value: part });
            }
          }
        });
      }
    });

    flushLine();
    return lines;
  }

  function renderDiffLines(lines, pane, isLeft, options, startIdx, endIdx) {
    const showLineNumbers = optLineNumbers.checked;
    const wrapLines = optWrapLines.checked;
    const diffMode = optDiffMode.value;

    const container = document.createElement('div');
    container.className = 'diff-pane-content';
    if (!wrapLines) container.style.whiteSpace = 'pre';

    for (let i = startIdx; i < endIdx && i < lines[isLeft ? 'left' : 'right'].length; i++) {
      const line = lines[isLeft ? 'left' : 'right'][i];
      const lineDiv = document.createElement('div');
      lineDiv.className = 'diff-line';
      lineDiv.dataset.lineNum = line.num;

      if (showLineNumbers) {
        const numSpan = document.createElement('span');
        numSpan.className = 'diff-line-num';
        numSpan.textContent = line.num;
        lineDiv.appendChild(numSpan);
      }

      const textSpan = document.createElement('span');
      textSpan.className = 'diff-line-text';
      if (!wrapLines) textSpan.style.whiteSpace = 'pre';

      line.tokens.forEach(token => {
        const tokenSpan = document.createElement('span');
        tokenSpan.className = 'diff-token ' + token.type;
        tokenSpan.textContent = token.value;
        textSpan.appendChild(tokenSpan);
      });
      lineDiv.appendChild(textSpan);
      container.appendChild(lineDiv);
    }

    return container;
  }

  function renderVirtualized(diffLines, pane, isLeft, options) {
    const lineHeight = 24;
    const containerHeight = pane.clientHeight;
    const buffer = 50;

    function updateVisibleRange() {
      const scrollTop = pane.scrollTop;
      const start = Math.max(0, Math.floor(scrollTop / lineHeight) - buffer);
      const end = Math.min(diffLines[isLeft ? 'left' : 'right'].length, Math.ceil((scrollTop + containerHeight) / lineHeight) + buffer);

      if (start !== visibleLineRange.start || end !== visibleLineRange.end) {
        visibleLineRange = { start, end };
        renderChunk(diffLines, pane, isLeft, options, start, end);
      }
    }

    pane.removeEventListener('scroll', updateVisibleRange);
    pane.addEventListener('scroll', updateVisibleRange, { passive: true });

    updateVisibleRange();
  }

  function renderChunk(diffLines, pane, isLeft, options, start, end) {
    const existingContent = pane.querySelector('.diff-pane-content');
    if (existingContent) {
      const newContent = renderDiffLines(diffLines, pane, isLeft, options, start, end);
      pane.replaceChild(newContent, existingContent);
    } else {
      const content = renderDiffLines(diffLines, pane, isLeft, options, start, end);
      pane.innerHTML = '';
      pane.appendChild(content);
    }
  }

  function renderDiffProgressive(diffLines, pane, isLeft, options) {
    const totalLines = diffLines[isLeft ? 'left' : 'right'].length;

    if (totalLines <= VIRTUALIZATION_THRESHOLD) {
      const content = renderDiffLines(diffLines, pane, isLeft, options, 0, totalLines);
      pane.innerHTML = '';
      pane.appendChild(content);
      return;
    }

    allDiffLines = diffLines;
    visibleLineRange = { start: 0, end: 0 };
    renderVirtualized(diffLines, pane, isLeft, options);
  }

  function computeStats(diff) {
    let added = 0, removed = 0, unchanged = 0, addedWords = 0, removedWords = 0;
    diff.forEach(t => {
      const len = t.value.length;
      if (t.type === 'added') { added += len; addedWords += t.value.trim() ? 1 : 0; }
      else if (t.type === 'removed') { removed += len; removedWords += t.value.trim() ? 1 : 0; }
      else unchanged += len;
    });
    return { added, removed, unchanged, addedWords, removedWords };
  }

  function updateStats(diff) {
    const stats = computeStats(diff);
    leftStats.textContent = `−${stats.removed} chars (${stats.removedWords} words)  +${stats.added} chars (${stats.addedWords} words)`;
    rightStats.textContent = `+${stats.added} chars (${stats.addedWords} words)  −${stats.removed} chars (${stats.removedWords} words)`;
  }

  function runDiff() {
    const leftText = leftInput.value;
    const rightText = rightInput.value;

    if (!leftText && !rightText && !isLoadingFromHash) {
      showToast('Enter text in either pane to compare', 'warning');
      return;
    }

    const totalChars = leftText.length + rightText.length;
    if (totalChars > 500000) {
      showToast(`Large input (${(totalChars/1000).toFixed(0)}KB) - diff may take a moment`, 'info');
    }

    loading.classList.remove('hidden');
    diffOutput.classList.add('hidden');

    setTimeout(() => {
      const options = {
        trimWhitespace: optTrimWhitespace.checked,
        ignoreCase: optIgnoreCase.checked,
        ignoreWhitespace: optIgnoreWhitespace.checked,
        wordDiff: optWordDiff.checked,
        showUnchanged: optShowUnchanged.checked
      };

      const normLeft = normalizeText(leftText, options);
      const normRight = normalizeText(rightText, options);

      const leftTokens = tokenize(normLeft, options.wordDiff);
      const rightTokens = tokenize(normRight, options.wordDiff);

      const totalTokens = leftTokens.length + rightTokens.length;

      const startTime = performance.now();
      const diff = diffTokens(leftTokens, rightTokens);
      const diffTime = performance.now() - startTime;

      const diffLines = buildDiffLines(diff, options);

      const diffMode = optDiffMode.value;
      if (diffMode === 'unified') {
        leftPane.parentElement.style.gridTemplateColumns = '1fr';
        rightPane.style.display = 'none';
        renderDiffProgressive(diffLines, leftPane, true, options);
      } else {
        leftPane.parentElement.style.gridTemplateColumns = '1fr 1fr';
        rightPane.style.display = '';
        renderDiffProgressive(diffLines, leftPane, true, options);
        renderDiffProgressive(diffLines, rightPane, false, options);
      }
      updateStats(diff);

      currentDiffData = {
        left: leftText,
        right: rightText,
        options
      };

      diffOutput.classList.remove('hidden');
      loading.classList.add('hidden');
      btnShare.disabled = false;

      const renderTime = performance.now() - startTime - diffTime;
      if (totalTokens > 10000 || diffTime > 100) {
        showToast(`Diff: ${diffTime.toFixed(0)}ms, Render: ${renderTime.toFixed(0)}ms (${totalTokens} tokens)`, 'info');
      }

      syncScroll();
      saveOptions();
    }, 0);
  }

  function debouncedDiff() {
    if (autoDiffTimer) clearTimeout(autoDiffTimer);
    autoDiffTimer = setTimeout(runDiff, 500);
  }

  function syncScroll() {
    leftPane.scrollTop = 0;
    rightPane.scrollTop = 0;

    leftPane.addEventListener('scroll', () => {
      rightPane.scrollTop = leftPane.scrollTop;
      rightPane.scrollLeft = leftPane.scrollLeft;
    }, { passive: true });

    rightPane.addEventListener('scroll', () => {
      leftPane.scrollTop = rightPane.scrollTop;
      leftPane.scrollLeft = rightPane.scrollLeft;
    }, { passive: true });
  }

  function generateShareUrl() {
    if (!currentDiffData) return null;

    const data = JSON.stringify(currentDiffData);
    const compressed = btoa(encodeURIComponent(data));
    return `${window.location.origin}${window.location.pathname}#${compressed}`;
  }

  function loadFromHash() {
    const hash = window.location.hash.slice(1);
    if (!hash) return false;

    try {
      const data = JSON.parse(decodeURIComponent(atob(hash)));
      leftInput.value = data.left || '';
      rightInput.value = data.right || '';

      if (data.options) {
        optTrimWhitespace.checked = data.options.trimWhitespace ?? true;
        optIgnoreCase.checked = data.options.ignoreCase ?? false;
        optIgnoreWhitespace.checked = data.options.ignoreWhitespace ?? false;
        optWordDiff.checked = data.options.wordDiff ?? true;
        optShowUnchanged.checked = data.options.showUnchanged ?? true;
      }

      currentDiffData = data;
      isLoadingFromHash = true;
      runDiff();
      isLoadingFromHash = false;
      return true;
    } catch (e) {
      console.error('Failed to load shared diff:', e);
      return false;
    }
  }

  function copyShareLink() {
    const url = generateShareUrl();
    if (!url) return;

    navigator.clipboard.writeText(url).then(() => {
      showToast('Link copied to clipboard', 'success');
      btnShare.textContent = 'Copied!';
      setTimeout(() => btnShare.textContent = 'Share Link', 2000);
    }).catch(() => {
      showToast('Copy failed - select and copy manually', 'error');
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    });
  }

  function clearAll() {
    leftInput.value = '';
    rightInput.value = '';
    diffOutput.classList.add('hidden');
    btnShare.disabled = true;
    currentDiffData = null;
    allDiffLines = { left: [], right: [] };
    history.replaceState(null, '', window.location.pathname);
    leftInput.focus();
    showToast('Cleared', 'info');
  }

  function swapInputs() {
    const temp = leftInput.value;
    leftInput.value = rightInput.value;
    rightInput.value = temp;
    if (currentDiffData) runDiff();
  }

  function exportDiff(format) {
    if (!currentDiffData) return;
    const diffMode = optDiffMode.value;
    let output = '';

    if (format === 'markdown') {
      output = '# Diff\n\n';
      output += '## Original\n```\n' + currentDiffData.left + '\n```\n\n';
      output += '## Modified\n```\n' + currentDiffData.right + '\n```\n';
    } else if (format === 'html') {
      output = '<html><head><style>body{font-family:monospace}.added{background:#193825;color:#3fb950}.removed{background:#491117;color:#f85149;text-decoration:line-through}</style></head><body>';
      output += '<h1>Diff</h1><h2>Original</h2><pre>' + escapeHtml(currentDiffData.left) + '</pre>';
      output += '<h2>Modified</h2><pre>' + escapeHtml(currentDiffData.right) + '</pre></body></html>';
    }

    const blob = new Blob([output], { type: format === 'html' ? 'text/html' : 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diff.${format === 'html' ? 'html' : 'md'}`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported as ${format.toUpperCase()}`, 'success');
  }

  function escapeHtml(text) {
    return text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
  }

  function showShortcuts() {
    const shortcuts = [
      ['Ctrl+Enter', 'Run diff'],
      ['Ctrl+Shift+S', 'Share link'],
      ['Ctrl+Shift+X', 'Clear'],
      ['Ctrl+Shift+W', 'Swap panes'],
      ['Ctrl+Shift+E', 'Export Markdown'],
      ['Ctrl+Shift+H', 'Export HTML'],
      ['?', 'Show this help']
    ];
    let msg = 'Keyboard Shortcuts:\n';
    shortcuts.forEach(([k, v]) => msg += `  ${k.padEnd(16)} ${v}\n`);
    showToast(msg.replace(/\n/g, '<br>'), 'info');
  }

  btnDiff.addEventListener('click', runDiff);
  btnShare.addEventListener('click', copyShareLink);
  btnClear.addEventListener('click', clearAll);
  btnSwap.addEventListener('click', swapInputs);
  document.getElementById('btn-export-md').addEventListener('click', () => exportDiff('markdown'));
  document.getElementById('btn-export-html').addEventListener('click', () => exportDiff('html'));

  [optTrimWhitespace, optIgnoreCase, optIgnoreWhitespace, optWordDiff, optShowUnchanged, optLineNumbers, optWrapLines, optAutoDiff, optDiffMode].forEach(opt => {
    opt.addEventListener('change', () => {
      saveOptions();
      if (currentDiffData) runDiff();
    });
  });

  leftInput.addEventListener('input', () => {
    if (optAutoDiff.checked) debouncedDiff();
  });
  rightInput.addEventListener('input', () => {
    if (optAutoDiff.checked) debouncedDiff();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        runDiff();
      }
      return;
    }

    if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      showShortcuts();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 's':
          if (e.shiftKey) { e.preventDefault(); copyShareLink(); }
          break;
        case 'x':
          if (e.shiftKey) { e.preventDefault(); clearAll(); }
          break;
        case 'w':
          if (e.shiftKey) { e.preventDefault(); swapInputs(); }
          break;
        case 'e':
          if (e.shiftKey) { e.preventDefault(); exportDiff('markdown'); }
          break;
        case 'h':
          if (e.shiftKey) { e.preventDefault(); exportDiff('html'); }
          break;
      }
    }
  });

  loadOptions();

  if (!loadFromHash()) {
    leftInput.value = '';
    rightInput.value = '';
    diffOutput.classList.add('hidden');
    btnShare.disabled = true;
  }
})();