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


  const optIgnoreCase = document.getElementById('opt-ignore-case');
  const optIgnoreWhitespace = document.getElementById('opt-ignore-whitespace');
  const optWordDiff = document.getElementById('opt-word-diff');
  const optShowUnchanged = document.getElementById('opt-show-unchanged');
  const optWrapLines = document.getElementById('opt-wrap-lines');
  const segBtns = document.querySelectorAll('.seg-btn');

  let currentDiffMode = 'side-by-side';
  let currentDiffData = null;
  let autoDiffTimer = null;
  let isLoadingFromHash = false;
  let diffWorker = null;
  let renderChunkTimer = null;
  let visibleLineRange = { start: 0, end: 0 };
  let allDiffLines = { left: [], right: [] };

  const STORAGE_KEY = 'diff-tool-options';
  const HISTORY_KEY = 'diff-tool-history';
  const MAX_HISTORY = 10;
  const MAX_TOKENS_FAST_PATH = 50000;
  const RENDER_CHUNK_SIZE = 500;
  const VIRTUALIZATION_THRESHOLD = 2000;

  function getToggle(toggle) {
    return toggle.getAttribute('aria-checked') === 'true';
  }

  function setToggle(toggle, value) {
    toggle.setAttribute('aria-checked', value ? 'true' : 'false');
  }

  function loadOptions() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const opts = JSON.parse(stored);

        setToggle(optIgnoreCase, opts.ignoreCase ?? false);
        setToggle(optIgnoreWhitespace, opts.ignoreWhitespace ?? false);
        setToggle(optWordDiff, opts.wordDiff ?? true);
        setToggle(optShowUnchanged, opts.showUnchanged ?? true);
        setToggle(optWrapLines, opts.wrapLines ?? true);
        currentDiffMode = opts.diffMode === 'unified' ? 'unified' : 'side-by-side';
      }
    } catch (e) {
      console.warn('Failed to load options:', e);
    }
    applyModeUI();
  }

  function saveOptions() {
    try {
      const opts = {

        ignoreCase: getToggle(optIgnoreCase),
        ignoreWhitespace: getToggle(optIgnoreWhitespace),
        wordDiff: getToggle(optWordDiff),
        showUnchanged: getToggle(optShowUnchanged),
        wrapLines: getToggle(optWrapLines),
        diffMode: currentDiffMode
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
    } catch (e) {
      console.warn('Failed to save options:', e);
    }
  }

  function applyModeUI() {
    segBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === currentDiffMode));
  }

  function setDiffMode(mode) {
    currentDiffMode = mode;
    applyModeUI();
    saveOptions();
    if (currentDiffData) runDiff();
  }

  function loadHistory() {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.warn('Failed to load history:', e);
      return [];
    }
  }

  function saveHistory(list) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
    } catch (e) {
      console.warn('Failed to save history:', e);
    }
  }

  function pushHistory(entry) {
    const list = loadHistory();
    const top = list[0];
    if (top && top.left === entry.left && top.right === entry.right) return;
    list.unshift({ ...entry, time: Date.now() });
    saveHistory(list);
    renderHistory();
  }

  function renderHistory() {
    const list = loadHistory();
    const container = document.getElementById('history-list');
    const tabBtn = document.querySelector('.tab-btn[data-tab="history"]');
    if (tabBtn) tabBtn.textContent = `History (${list.length})`;

    container.innerHTML = '';

    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = 'No recent diffs yet';
      container.appendChild(empty);
      return;
    }

    list.forEach((entry, idx) => {
      const item = document.createElement('div');
      item.className = 'history-item';

      const header = document.createElement('div');
      header.className = 'history-item-header';
      const title = document.createElement('span');
      title.textContent = `Diff ${list.length - idx}`;
      const time = document.createElement('span');
      time.className = 'history-item-time';
      time.textContent = new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      header.appendChild(title);
      header.appendChild(time);
      item.appendChild(header);

      const preview = document.createElement('div');
      preview.className = 'history-item-preview';
      const leftPrev = document.createElement('span');
      leftPrev.className = 'history-preview-left';
      leftPrev.textContent = entry.left.replace(/\s+/g, ' ').trim().slice(0, 60) || '(empty)';
      const rightPrev = document.createElement('span');
      rightPrev.className = 'history-preview-right';
      rightPrev.textContent = entry.right.replace(/\s+/g, ' ').trim().slice(0, 60) || '(empty)';
      preview.appendChild(leftPrev);
      preview.appendChild(rightPrev);
      item.appendChild(preview);

      const actions = document.createElement('div');
      actions.className = 'history-item-actions';
      const delBtn = document.createElement('button');
      delBtn.className = 'btn ghost';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = loadHistory();
        next.splice(idx, 1);
        saveHistory(next);
        renderHistory();
      });
      actions.appendChild(delBtn);
      item.appendChild(actions);

      item.addEventListener('click', () => {
        leftInput.value = entry.left;
        rightInput.value = entry.right;
        updateCharCounts();
        runDiff();
      });

      container.appendChild(item);
    });
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
  
    if (options.ignoreCase) {
      text = text.toLowerCase();
    }
    if (options.ignoreWhitespace) {
      text = text.replace(/[ \t\r\f\v]+/g, ' ');
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
    const v = new Array(2 * maxD + 1);
    const offset = maxD;
    const rows = [];

    v[offset + 1] = 0;

    for (let d = 0; d <= maxD; d++) {
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
          x = v[offset + k + 1];
        } else {
          x = v[offset + k - 1] + 1;
        }

        let y = x - k;

        while (x < n && y < m && oldTokens[x] === newTokens[y]) {
          x++;
          y++;
        }

        v[offset + k] = x;

        if (x >= n && y >= m) {
          rows.push(v.slice());
          return backtrack(oldTokens, newTokens, rows, d);
        }
      }
      rows.push(v.slice());
    }

    return backtrack(oldTokens, newTokens, rows, maxD);
  }

  function backtrack(oldTokens, newTokens, rows, d) {
    const result = [];
    const n = oldTokens.length;
    const m = newTokens.length;
    const offset = n + m;
    let x = n, y = m;

    for (let i = d - 1; i >= 0; i--) {
      const v = rows[i];
      const dCur = i + 1;
      const k = x - y;
      const prevK = (k === -dCur || (k !== dCur && v[offset + k - 1] < v[offset + k + 1])) ? k + 1 : k - 1;
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

    while (x > 0 && y > 0) {
      result.unshift({ type: 'equal', value: oldTokens[x - 1] });
      x--; y--;
    }

    return result;
  }

  function diffTokens(oldTokens, newTokens) {
    const totalTokens = oldTokens.length + newTokens.length;
    if (totalTokens > MAX_TOKENS_FAST_PATH) {
      return diffTokensChunked(oldTokens, newTokens);
    }
    const diff = myersDiff(oldTokens, newTokens);
    return refineDiffWithCharLevel(diff);
  }

  function refineDiffWithCharLevel(diff) {
    const result = [];
    let i = 0;
    while (i < diff.length) {
      const token = diff[i];
      if (token.type === 'equal') {
        result.push(token);
        i++;
        continue;
      }

      const removedSeq = [];
      const addedSeq = [];

      while (i < diff.length && diff[i].type === 'removed') {
        removedSeq.push(diff[i].value);
        i++;
      }
      while (i < diff.length && diff[i].type === 'added') {
        addedSeq.push(diff[i].value);
        i++;
      }

      if (removedSeq.length > 0 && addedSeq.length > 0) {
        const oldText = removedSeq.join('');
        const newText = addedSeq.join('');
        if (oldText.length > 0 && newText.length > 0 && oldText.length < 5000 && newText.length < 5000) {
          const charDiff = myersDiff(oldText.split(''), newText.split(''));
          let hasActualChanges = false;
          for (const ct of charDiff) {
            if (ct.type !== 'equal') {
              hasActualChanges = true;
              break;
            }
          }
          if (hasActualChanges) {
            result.push(...charDiff.map(ct => ({ ...ct, type: ct.type === 'equal' ? 'equal' : ct.type })));
          } else {
            result.push(...removedSeq.map(v => ({ type: 'removed', value: v })));
            result.push(...addedSeq.map(v => ({ type: 'added', value: v })));
          }
        } else {
          result.push(...removedSeq.map(v => ({ type: 'removed', value: v })));
          result.push(...addedSeq.map(v => ({ type: 'added', value: v })));
        }
      } else {
        result.push(...removedSeq.map(v => ({ type: 'removed', value: v })));
        result.push(...addedSeq.map(v => ({ type: 'added', value: v })));
      }
    }
    return result;
  }

  function diffTokensChunked(oldTokens, newTokens) {
    const chunkSize = 10000;
    const result = [];

    for (let i = 0; i < oldTokens.length; i += chunkSize) {
      const oldChunk = oldTokens.slice(i, i + chunkSize);
      const newChunk = newTokens.slice(i, i + chunkSize);
      const chunkDiff = myersDiff(oldChunk, newChunk);
      result.push(...refineDiffWithCharLevel(chunkDiff));
    }

    return result;
  }

  function buildDiffLines(diff, options, mode) {
    const showUnchanged = options.showUnchanged;
    const unified = mode === 'unified';
    const lines = { left: [], right: [] };
    let currentLine = { left: [], right: [] };
    let lineNum = 1;

    function flushLine() {
      if (currentLine.left.length === 0 && currentLine.right.length === 0) return;
      lines.left.push({
        num: lineNum,
        tokens: currentLine.left,
        hasChanges: currentLine.left.some(t => t.type !== 'equal')
      });
      lines.right.push({
        num: lineNum,
        tokens: currentLine.right,
        hasChanges: currentLine.right.some(t => t.type !== 'equal')
      });
      lineNum++;
      currentLine = { left: [], right: [] };
    }

    function pushLeft(type, value) {
      currentLine.left.push({ type, value });
      if (unified) currentLine.right.push({ type, value });
    }

    function pushRight(type, value) {
      currentLine.right.push({ type, value });
      if (unified) currentLine.left.push({ type, value });
    }

    function pushSplit(type, value) {
      if (type === 'added') {
        pushLeft('equal', '');
        pushRight('added', value);
      } else if (type === 'removed') {
        pushLeft('removed', value);
        pushRight('equal', '');
      } else {
        pushLeft('equal', value);
        pushRight('equal', value);
      }
    }

    diff.forEach(token => {
      if (token.value === '\n' || token.value === '\r') {
        flushLine();
        return;
      }

      if (!showUnchanged && token.type === 'equal') return;

      const type = token.type;
      const value = token.value;

      if (unified) {
        pushLeft(type, value);
      } else {
        pushSplit(type, value);
      }

      if (value.includes('\n')) {
        const parts = value.split('\n');
        parts.forEach((part, idx) => {
          if (idx > 0) {
            flushLine();
            if (part.length > 0) {
              if (unified) {
                pushLeft(type, part);
              } else {
                pushSplit(type, part);
              }
            }
          }
        });
      }
    });

    flushLine();
    return lines;
  }

  function ensurePaneStructure(pane) {
    let scrollWrapper = pane.querySelector('.diff-pane-scroll');
    if (!scrollWrapper) {
      pane.innerHTML = '';
      scrollWrapper = document.createElement('div');
      scrollWrapper.className = 'diff-pane-scroll';
      pane.appendChild(scrollWrapper);

      const minimap = document.createElement('div');
      minimap.className = 'diff-minimap';
      pane.appendChild(minimap);
    }
    return scrollWrapper;
  }

  function renderDiffLines(lines, pane, isLeft, options, startIdx, endIdx) {
    const showLineNumbers = true;
    const wrapLines = getToggle(optWrapLines);

    const scrollWrapper = ensurePaneStructure(pane);
    const minimap = pane.querySelector('.diff-minimap');

    const container = document.createElement('div');
    container.className = 'diff-pane-content';
    if (!wrapLines) container.style.whiteSpace = 'pre';

    const totalLines = lines[isLeft ? 'left' : 'right'].length;
    const paneHeight = pane.clientHeight || 400;

    minimap.innerHTML = '';

    for (let i = startIdx; i < endIdx && i < lines[isLeft ? 'left' : 'right'].length; i++) {
      const line = lines[isLeft ? 'left' : 'right'][i];
      const lineDiv = document.createElement('div');
      lineDiv.className = 'diff-line';
      lineDiv.dataset.lineNum = line.num;
      if (line.hasChanges) {
        lineDiv.classList.add('diff-line-changed');

        const badge = document.createElement('span');
        badge.className = 'diff-change-badge ' + (isLeft ? 'removed' : 'added');
        badge.textContent = isLeft ? '−' : '+';
        lineDiv.appendChild(badge);

        const markTop = (i / Math.max(1, totalLines - 1)) * paneHeight;
        const mark = document.createElement('div');
        mark.className = 'diff-minimap-mark ' + (isLeft ? 'removed' : 'added');
        mark.style.top = markTop + 'px';
        minimap.appendChild(mark);
      }

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
    const scrollWrapper = pane.querySelector('.diff-pane-scroll');
    const containerHeight = scrollWrapper ? scrollWrapper.clientHeight : pane.clientHeight;
    const buffer = 50;

    function updateVisibleRange() {
      const scrollTop = scrollWrapper ? scrollWrapper.scrollTop : pane.scrollTop;
      const start = Math.max(0, Math.floor(scrollTop / lineHeight) - buffer);
      const end = Math.min(diffLines[isLeft ? 'left' : 'right'].length, Math.ceil((scrollTop + containerHeight) / lineHeight) + buffer);

      if (start !== visibleLineRange.start || end !== visibleLineRange.end) {
        visibleLineRange = { start, end };
        renderChunk(diffLines, pane, isLeft, options, start, end);
      }
    }

    if (scrollWrapper) {
      scrollWrapper.removeEventListener('scroll', updateVisibleRange);
      scrollWrapper.addEventListener('scroll', updateVisibleRange, { passive: true });
    } else {
      pane.removeEventListener('scroll', updateVisibleRange);
      pane.addEventListener('scroll', updateVisibleRange, { passive: true });
    }

    updateVisibleRange();
  }

  function renderChunk(diffLines, pane, isLeft, options, start, end) {
    const scrollWrapper = pane.querySelector('.diff-pane-scroll');
    const existingContent = scrollWrapper ? scrollWrapper.querySelector('.diff-pane-content') : pane.querySelector('.diff-pane-content');
    const newContent = renderDiffLines(diffLines, pane, isLeft, options, start, end);
    if (existingContent) {
      (scrollWrapper || pane).replaceChild(newContent, existingContent);
    } else {
      if (scrollWrapper) {
        scrollWrapper.innerHTML = '';
        scrollWrapper.appendChild(newContent);
      } else {
        pane.innerHTML = '';
        pane.appendChild(newContent);
      }
    }
  }

  function renderDiffProgressive(diffLines, pane, isLeft, options) {
    const totalLines = diffLines[isLeft ? 'left' : 'right'].length;

    if (totalLines <= VIRTUALIZATION_THRESHOLD) {
      const content = renderDiffLines(diffLines, pane, isLeft, options, 0, totalLines);
      const scrollWrapper = ensurePaneStructure(pane);
      scrollWrapper.innerHTML = '';
      scrollWrapper.appendChild(content);
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

        ignoreCase: getToggle(optIgnoreCase),
        ignoreWhitespace: getToggle(optIgnoreWhitespace),
        wordDiff: getToggle(optWordDiff),
        showUnchanged: getToggle(optShowUnchanged)
      };

      const normLeft = normalizeText(leftText, options);
      const normRight = normalizeText(rightText, options);

      const leftTokens = tokenize(normLeft, options.wordDiff);
      const rightTokens = tokenize(normRight, options.wordDiff);

      const totalTokens = leftTokens.length + rightTokens.length;

      const startTime = performance.now();
      const diff = diffTokens(leftTokens, rightTokens);
      const diffTime = performance.now() - startTime;

      const diffLines = buildDiffLines(diff, options, currentDiffMode);

      if (currentDiffMode === 'unified') {
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

      if (leftText || rightText) {
        pushHistory({ left: leftText, right: rightText, options });
      }

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

  let scrollSynced = false;

  function getScrollWrapper(pane) {
    return pane.querySelector('.diff-pane-scroll') || pane;
  }

  function syncScroll() {
    if (!scrollSynced) {
      const leftWrapper = getScrollWrapper(leftPane);
      const rightWrapper = getScrollWrapper(rightPane);

      leftWrapper.addEventListener('scroll', () => {
        rightWrapper.scrollTop = leftWrapper.scrollTop;
        rightWrapper.scrollLeft = leftWrapper.scrollLeft;
      }, { passive: true });

      rightWrapper.addEventListener('scroll', () => {
        leftWrapper.scrollTop = rightWrapper.scrollTop;
        leftWrapper.scrollLeft = rightWrapper.scrollLeft;
      }, { passive: true });

      scrollSynced = true;
    }

    const leftWrapper = getScrollWrapper(leftPane);
    const rightWrapper = getScrollWrapper(rightPane);
    leftWrapper.scrollTop = 0;
    rightWrapper.scrollTop = 0;
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

        setToggle(optIgnoreCase, data.options.ignoreCase ?? false);
        setToggle(optIgnoreWhitespace, data.options.ignoreWhitespace ?? false);
        setToggle(optWordDiff, data.options.wordDiff ?? true);
        setToggle(optShowUnchanged, data.options.showUnchanged ?? true);
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

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function showShortcuts() {
    const shortcuts = [
      ['Ctrl+Enter', 'Run diff'],
      ['Ctrl+Shift+S', 'Share link'],
      ['Ctrl+Shift+X', 'Clear'],
      ['Ctrl+Shift+W', 'Swap panes'],
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

  [optIgnoreCase, optIgnoreWhitespace, optWordDiff, optShowUnchanged, optWrapLines].forEach(opt => {
    opt.addEventListener('click', () => {
      const newValue = !getToggle(opt);
      setToggle(opt, newValue);
      saveOptions();
      if (currentDiffData) runDiff();
    });
  });

  segBtns.forEach(btn => {
    btn.addEventListener('click', () => setDiffMode(btn.dataset.mode));
  });

  function updateCharCounts() {
    const leftCount = document.getElementById('left-count');
    const rightCount = document.getElementById('right-count');
    if (leftCount) leftCount.textContent = `${leftInput.value.length} chars`;
    if (rightCount) rightCount.textContent = `${rightInput.value.length} chars`;
  }

  function blurDiff() {
    if (leftInput.value || rightInput.value) runDiff();
  }

  leftInput.addEventListener('input', () => {
    updateCharCounts();
    debouncedDiff();
  });
  rightInput.addEventListener('input', () => {
    updateCharCounts();
    debouncedDiff();
  });

  leftInput.addEventListener('blur', blurDiff);
  rightInput.addEventListener('blur', blurDiff);

  leftInput.addEventListener('paste', () => setTimeout(runDiff, 0));
  rightInput.addEventListener('paste', () => setTimeout(runDiff, 0));

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
      }
    }
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const tab = btn.dataset.tab;
      document.getElementById('tab-options').classList.toggle('hidden', tab !== 'options');
      document.getElementById('tab-history').classList.toggle('hidden', tab !== 'history');
    });
  });

  loadOptions();
  renderHistory();

  if (!loadFromHash()) {
    leftInput.value = '';
    rightInput.value = '';
    diffOutput.classList.add('hidden');
    btnShare.disabled = true;
  }
})();
