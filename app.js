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

  let currentDiffData = null;

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

  function diffTokens(oldTokens, newTokens) {
    const m = oldTokens.length;
    const n = newTokens.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldTokens[i - 1] === newTokens[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const result = [];
    let i = m, j = n;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
        result.unshift({ type: 'equal', value: oldTokens[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        result.unshift({ type: 'added', value: newTokens[j - 1] });
        j--;
      } else if (i > 0) {
        result.unshift({ type: 'removed', value: oldTokens[i - 1] });
        i--;
      }
    }

    return result;
  }

  function renderDiff(diff, pane, isLeft, showUnchanged) {
    let lineNum = 1;
    let lineContent = [];
    const lines = [];

    function flushLine() {
      if (lineContent.length === 0) return;
      const lineDiv = document.createElement('div');
      lineDiv.className = 'diff-line';

      const numSpan = document.createElement('span');
      numSpan.className = 'diff-line-num';
      numSpan.textContent = lineNum;
      lineDiv.appendChild(numSpan);

      const textSpan = document.createElement('span');
      textSpan.className = 'diff-line-text';
      lineContent.forEach(token => {
        const tokenSpan = document.createElement('span');
        tokenSpan.className = 'diff-token ' + token.type;
        tokenSpan.textContent = token.value;
        textSpan.appendChild(tokenSpan);
      });
      lineDiv.appendChild(textSpan);
      lines.push(lineDiv);
      lineNum++;
      lineContent = [];
    }

    diff.forEach(token => {
      if (token.value === '\n' || token.value === '\r') {
        flushLine();
        return;
      }

      const shouldShow = showUnchanged || token.type !== 'equal';
      if (!shouldShow) return;

      let type = token.type;
      if (isLeft) {
        if (token.type === 'added') type = 'equal';
        else if (token.type === 'removed') type = 'removed';
      } else {
        if (token.type === 'removed') type = 'equal';
        else if (token.type === 'added') type = 'added';
      }

      lineContent.push({ type, value: token.value });

      if (token.value.includes('\n')) {
        const parts = token.value.split('\n');
        parts.forEach((part, idx) => {
          if (idx > 0) {
            flushLine();
            if (part.length > 0) {
              lineContent.push({ type, value: part });
            }
          }
        });
      }
    });

    flushLine();

    const container = document.createElement('div');
    container.className = 'diff-pane-content';
    lines.forEach(line => container.appendChild(line));

    if (lines.length === 0) {
      container.className = 'diff-empty';
      container.textContent = 'No changes';
    }

    pane.innerHTML = '';
    pane.appendChild(container);
  }

  function computeStats(diff) {
    let added = 0, removed = 0, unchanged = 0;
    diff.forEach(t => {
      if (t.type === 'added') added += t.value.length;
      else if (t.type === 'removed') removed += t.value.length;
      else unchanged += t.value.length;
    });
    return { added, removed, unchanged };
  }

  function updateStats(diff) {
    const stats = computeStats(diff);
    leftStats.textContent = `-${stats.removed} chars  +${stats.added} chars`;
    rightStats.textContent = `+${stats.added} chars  -${stats.removed} chars`;
  }

  function runDiff() {
    const leftText = leftInput.value;
    const rightText = rightInput.value;

    if (!leftText && !rightText) {
      alert('Please enter text to compare');
      return;
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

      const diff = diffTokens(leftTokens, rightTokens);

      renderDiff(diff, leftPane, true, options.showUnchanged);
      renderDiff(diff, rightPane, false, options.showUnchanged);
      updateStats(diff);

      currentDiffData = {
        left: leftText,
        right: rightText,
        options
      };

      diffOutput.classList.remove('hidden');
      loading.classList.add('hidden');
      btnShare.disabled = false;

      syncScroll();
    }, 0);
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
      runDiff();
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
      btnShare.textContent = 'Copied!';
      setTimeout(() => btnShare.textContent = 'Share Link', 2000);
    }).catch(() => {
      prompt('Copy this link:', url);
    });
  }

  function clearAll() {
    leftInput.value = '';
    rightInput.value = '';
    diffOutput.classList.add('hidden');
    btnShare.disabled = true;
    currentDiffData = null;
    history.replaceState(null, '', window.location.pathname);
    leftInput.focus();
  }

  function swapInputs() {
    const temp = leftInput.value;
    leftInput.value = rightInput.value;
    rightInput.value = temp;
    if (currentDiffData) runDiff();
  }

  btnDiff.addEventListener('click', runDiff);
  btnShare.addEventListener('click', copyShareLink);
  btnClear.addEventListener('click', clearAll);
  btnSwap.addEventListener('click', swapInputs);

  [optTrimWhitespace, optIgnoreCase, optIgnoreWhitespace, optWordDiff, optShowUnchanged].forEach(opt => {
    opt.addEventListener('change', () => {
      if (currentDiffData) runDiff();
    });
  });

  leftInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      runDiff();
    }
  });

  rightInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      runDiff();
    }
  });

  if (!loadFromHash()) {
    const demoLeft = ``;

    const demoRight = ``;

    leftInput.value = demoLeft;
    rightInput.value = demoRight;
    runDiff();
  }
})();
