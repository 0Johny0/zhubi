/* ================================================================
   sync.js — 页码映射、双向同步、选区高亮
   ================================================================ */

var _lockTimer;
function lockSync(ms) {
  S.syncLock = true;
  clearTimeout(_lockTimer);
  _lockTimer = setTimeout(function () { S.syncLock = false; }, ms || 800);
}

function rebuildMap() {
  var text = el.editor.value;
  var res = buildPageMap(text);
  if (res) { S.pageMap = res.regions; S.isEstimate = false; updateMapUI(); return; }
  if (S.pdf && S.pageTexts && S.pageTexts.length) {
    try {
      var aligned = buildAlignedMap(text);
      if (aligned) { S.pageMap = aligned; S.isEstimate = true; updateMapUI(); return; }
    } catch (e) { }
  }
  if (S.pdf && S.total > 0) {
    var p = buildPropMap(text, S.total);
    if (p) { S.pageMap = p.regions; S.isEstimate = true; }
    else { S.pageMap = null; S.isEstimate = false; }
  } else { S.pageMap = null; S.isEstimate = false; }
  updateMapUI();
}

function updateMapUI() {
  if (S.pageMap && S.pageMap.length > 0 && S.pdf) {
    el.syncGrp.style.display = 'flex'; el.sepSync.style.display = '';
    el.mapInfo.textContent = S.isEstimate ? (S.pageTexts ? '≈ 智能对齐' : '≈ 估算') : ('✓ ' + S.pageMap.length + ' 标记');
  } else if (S.pdf) { el.mapInfo.textContent = '无标记'; }
  renderPageStrip();
}

function buildPageMap(text) {
  if (!text || !text.trim()) return null;
  var pats = [
    { re: /^\/\/\s*──\s*第\s*(\d+)\s*页/gm },
    { re: /^#{1,4}\s+.*?第\s*(\d+)\s*页/gmi },
    { re: /[─━═\-–—]{2,}\s*第\s*(\d+)\s*页\s*[─━═\-–—]{0,}/g },
    { re: /\f/g, named: false }
  ];
  for (var pi = 0; pi < pats.length; pi++) {
    var re = pats[pi].re, named = pats[pi].named;
    var mk = [], m; re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) mk.push({ pos: m.index, len: m[0].length, page: (named === false ? 0 : parseInt(m[1])) });
    if (!mk.length) continue;
    mk.sort(function (a, b) { return a.pos - b.pos; });
    if (!mk[0].page || mk[0].page < 1) mk.forEach(function (x, i) { x.page = i + 1; });
    var regions = [];
    for (var i = 0; i < mk.length; i++) {
      var cs = mk[i].pos + mk[i].len, skip = (cs < text.length && text[cs] === '\n') ? 1 : 0;
      regions.push({ page: mk[i].page, textStart: cs + skip, textEnd: (i + 1 < mk.length ? mk[i + 1].pos : text.length) });
    }
    if (mk[0].pos > 0 && text.substring(0, mk[0].pos).trim().length > 10) regions.unshift({ page: mk[0].page, textStart: 0, textEnd: mk[0].pos });
    return { regions: regions, detected: true };
  }
  return null;
}

function buildAlignedMap(mdText) {
  if (!S.pageTexts || !mdText.trim()) return null;
  var mdLen = mdText.length;
  var contentStart = scanForContent(mdText);
  S.contentStart = contentStart;
  if (contentStart <= 0) { contentStart = findContentByPdfMatch(mdText); S.contentStart = contentStart; }
  var startPageIdx = contentStart > 0 ? findStartPageIdx(mdText, contentStart) : 0;
  var regions = [], cursor = Math.max(contentStart, 0);
  if (startPageIdx > 0 && cursor > 0) {
    var chunk = cursor / startPageIdx;
    for (var i = 0; i < startPageIdx; i++) regions.push({ page: i + 1, textStart: Math.round(i * chunk), textEnd: Math.round((i + 1) * chunk) });
  }
  for (var i = startPageIdx; i < S.total; i++) {
    var pageEnd = (i + 1 < S.total) ? findPageBoundary(mdText, i + 1, cursor) : mdLen;
    pageEnd = Math.max(Math.min(pageEnd, mdLen), cursor + 1);
    regions.push({ page: i + 1, textStart: cursor, textEnd: pageEnd });
    cursor = pageEnd;
  }
  return regions;
}

function scanForContent(mdText) {
  var lines = mdText.split('\n'), inFM = false, inCB = false, pos = 0;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i], trimmed = line.trim(), nextPos = pos + line.length + 1;
    if (i === 0 && trimmed === '---') { inFM = true; pos = nextPos; continue; }
    if (inFM) { if (trimmed === '---') inFM = false; pos = nextPos; continue; }
    if (/^```/.test(trimmed)) { inCB = !inCB; pos = nextPos; continue; }
    if (inCB || /^#\w/.test(trimmed) || /^\/\/|^\/\*/.test(trimmed) || !trimmed) { pos = nextPos; continue; }
    if (/[\u4e00-\u9fff]/.test(trimmed) && trimmed.length > 10) return pos;
    pos = nextPos;
  }
  return 0;
}

function findContentByPdfMatch(mdText) {
  if (!S.pageTexts) return 0;
  var ranked = [];
  for (var i = 0; i < S.total; i++) { var cl = S.pageTexts[i].replace(/\s+/g, ''); if (cl.length > 50) ranked.push({ idx: i, len: cl.length }); }
  ranked.sort(function (a, b) { return b.len - a.len; });
  for (var r = 0; r < Math.min(ranked.length, 5); r++) {
    var idx = ranked[r].idx, key = cleanKey(S.pageTexts[idx], 50);
    if (key.length < 10) continue;
    var pos = findFragment(mdText, key, Math.floor(mdText.length * 0.03));
    if (pos >= 0 && pos < mdText.length * 0.7 && !isInsideCode(mdText, pos)) return pos;
  }
  return 0;
}

function isInsideCode(text, pos) {
  var lines = text.split('\n'), p = 0, inCB = false, inFM = false;
  for (var i = 0; i < lines.length; i++) {
    var end = p + lines[i].length;
    if (pos >= p && pos <= end) return inCB || inFM || /^#\w/.test(lines[i].trim()) || /^\/\/|^\/\*/.test(lines[i].trim());
    if (i === 0 && lines[i].trim() === '---') inFM = true; else if (inFM && lines[i].trim() === '---') inFM = false;
    if (/^```/.test(lines[i].trim())) inCB = !inCB;
    p = end + 1;
  }
  return false;
}

function findStartPageIdx(mdText, contentStart) {
  var body = mdText.substring(contentStart, Math.min(contentStart + 400, mdText.length));
  var cleanBody = body.replace(/[^\u4e00-\u9fff\u3000-\u303fa-zA-Z0-9]/g, '');
  if (cleanBody.length < 6) return 0;
  for (var len = Math.min(cleanBody.length, 50); len >= 8; len -= 5) {
    var key = cleanBody.substring(0, len);
    for (var i = 0; i < S.total; i++) {
      if (S.pageTexts[i].replace(/[^\u4e00-\u9fff\u3000-\u303fa-zA-Z0-9]/g, '').indexOf(key) >= 0) return i;
    }
  }
  return 0;
}

function findPageBoundary(mdText, nextPageIdx, searchFrom) {
  var key = cleanKey(S.pageTexts[nextPageIdx], 40);
  var found = findFragment(mdText, key, searchFrom + 5);
  if (found >= 0) return found;
  for (var len = 35; len >= 10; len -= 5) {
    found = findFragment(mdText, cleanKey(S.pageTexts[nextPageIdx], len), searchFrom + 5);
    if (found >= 0) return found;
  }
  var remain = mdText.length - searchFrom, totalW = 0;
  for (var j = nextPageIdx; j < S.total; j++) totalW += Math.max(1, S.pageTexts[j].replace(/\s/g, '').length);
  return Math.round(searchFrom + Math.max(1, S.pageTexts[nextPageIdx].replace(/\s/g, '').length) / totalW * remain);
}

function cleanKey(raw, maxLen) { return raw.replace(/\s+/g, '').substring(0, maxLen); }

function findFragment(text, query, startPos) {
  if (!query || query.length < 6) return -1;
  var pos = text.indexOf(query, startPos); if (pos >= 0) return pos;
  for (var len = query.length - 3; len >= 8; len -= 3) {
    pos = text.indexOf(query.substring(0, len), startPos); if (pos >= 0) return pos;
    pos = text.indexOf(query.substring(query.length - len), startPos); if (pos >= 0) return pos;
  }
  var sparse = ''; for (var i = 0; i < query.length; i += 2) sparse += query[i];
  if (sparse.length >= 6) { pos = text.indexOf(sparse, startPos); if (pos >= 0) return pos; }
  return -1;
}

function buildPropMap(text, np) {
  if (!text || !np) return null;
  var len = text.length, cp = Math.ceil(len / np), r = [];
  for (var i = 0; i < np; i++) r.push({ page: i + 1, textStart: i * cp, textEnd: Math.min((i + 1) * cp, len) });
  return { regions: r, detected: false };
}

function renderPageStrip() {
  var ps = el.pageStrip;
  if (!S.pageMap || !S.pageMap.length || !S.pdf) { ps.style.display = 'none'; return; }
  ps.style.display = 'block';
  var tLen = el.editor.value.length || 1, sH = ps.clientHeight || 400, h = '';
  for (var i = 0; i < S.pageMap.length; i++) {
    var r = S.pageMap[i], ch = Math.max(1, r.textEnd - r.textStart);
    h += '<div class="ps-seg' + (r.page === S.pg ? ' current' : '') + '" style="top:' + (r.textStart / tLen * sH) + 'px;height:' + Math.max(16, ch / tLen * sH) + 'px" data-p="' + r.page + '">' + r.page + '</div>';
  }
  h += '<div class="ps-viewport" id="psVp"></div>';
  if (S.isEstimate) h += '<div class="ps-badge">≈</div>';
  ps.innerHTML = h; updateVpOverlay();
  var segs = ps.querySelectorAll('.ps-seg');
  for (var si = 0; si < segs.length; si++) {
    (function (seg) { seg.addEventListener('click', function () {
      var p = parseInt(seg.dataset.p);
      lockSync(1000); scrollToPageNum(p); scrollToTextPage(p);
    }); })(segs[si]);
  }
}
function updateVpOverlay() {
  var vp = document.getElementById('psVp'); if (!vp || !S.pageMap) return;
  var sH = el.pageStrip.clientHeight || 400;
  var act = (S.mode === 'preview' ? el.mdPreview : el.editor);
  var ratio = sH / (act.scrollHeight || 1);
  vp.style.top = (act.scrollTop * ratio) + 'px';
  vp.style.height = Math.max(6, act.clientHeight * ratio) + 'px';
}

function scrollToTextPage(pn) {
  if (!S.pageMap) return;
  var region = null;
  for (var i = 0; i < S.pageMap.length; i++) { if (S.pageMap[i].page === pn) { region = S.pageMap[i]; break; } }
  if (!region) return;
  lockSync(1000);
  var ln = (el.editor.value.substring(0, region.textStart).match(/\n/g) || []).length;
  var lh = parseFloat(getComputedStyle(el.editor).lineHeight) || 28;
  var target = Math.max(0, ln * lh - el.editor.clientHeight / 4);
  el.editor.scrollTo({ top: target });
  if (S.mode !== 'source') el.mdPreview.scrollTo({ top: target });
}

function scrollToPageNum(n) {
  if (n < 1 || n > S.total || !pageDims.length) return;
  lockSync(1000);
  el.pdfVp.scrollTo({ top: Math.max(0, pageDims[n - 1].top - 16) });
  S.pg = n; el.pgInput.value = n; updatePgOverlay(); renderPageStrip();
}

function go(d) {
  var n = Math.max(1, Math.min(S.total, S.pg + d));
  lockSync(1000); scrollToPageNum(n); scrollToTextPage(n);
}

var scrollRAF;
function onPdfScroll() {
  if (S.syncLock) return;
  cancelAnimationFrame(scrollRAF);
  scrollRAF = requestAnimationFrame(function () {
    if (S.syncLock) return;
    var np = calcPage();
    if (np !== S.pg) {
      S.pg = np; el.pgInput.value = np; updatePgOverlay(); renderPageStrip();
      if (S.syncOn) { lockSync(1000); scrollToTextPage(np); }
    }
  });
}

function calcPage() {
  if (!pageDims.length) return 1;
  var c = el.pdfVp.scrollTop + el.pdfVp.clientHeight * 0.35, p = 1;
  for (var i = 0; i < pageDims.length; i++) { if (c >= pageDims[i].top + pageDims[i].sh / 2) p = i + 2; }
  return Math.min(p, S.total);
}
function updatePgOverlay() { el.pgOverlay.textContent = '第 ' + S.pg + ' / ' + S.total + ' 页'; }

function getPageAtCursor() {
  if (!S.pageMap) return null;
  var pos = el.editor.selectionStart;
  for (var i = S.pageMap.length - 1; i >= 0; i--) { if (pos >= S.pageMap[i].textStart) return S.pageMap[i].page; }
  return S.pageMap[0] ? S.pageMap[0].page : null;
}

function syncFromEditor() {
  if (!S.syncOn || S.syncLock || !S.pageMap) return;
  if (el.editor.selectionStart !== el.editor.selectionEnd) return;
  var p = getPageAtCursor();
  if (p && p !== S.pg) { scrollToPageNum(p); flashSync('文 → 页: 第 ' + p + ' 页'); }
}

var _edScrollTimer;
function syncFromEditorScroll() {
  if (!S.syncOn || S.syncLock || !S.pageMap || !S.pageMap.length) return;
  if (el.editor.selectionStart !== el.editor.selectionEnd) return;
  var ta = el.editor;
  var lh = parseFloat(getComputedStyle(ta).lineHeight) || 28;
  var centerLine = Math.floor((ta.scrollTop + ta.clientHeight * 0.35) / lh);
  var text = ta.value, line = 0, pos = 0;
  for (var i = 0; i < text.length; i++) { if (line >= centerLine) break; if (text[i] === '\n') line++; pos = i + 1; }
  var page = S.pageMap[0].page;
  for (var i = S.pageMap.length - 1; i >= 0; i--) { if (pos >= S.pageMap[i].textStart) { page = S.pageMap[i].page; break; } }
  if (page !== S.pg) { scrollToPageNum(page); }
}

function flashSync(m) {
  el.syncBanner.textContent = m; el.syncBanner.classList.add('show');
  clearTimeout(flashSync._t); flashSync._t = setTimeout(function () { el.syncBanner.classList.remove('show'); }, 1200);
}

var _selTimer;
function debouncedHighlight() { clearTimeout(_selTimer); _selTimer = setTimeout(handleEditorSelection, 80); }

function handleEditorSelection() {
  try {
    var start = el.editor.selectionStart, end = el.editor.selectionEnd;
    if (start === end) { clearHighlights(); return; }
    var selectedText = el.editor.value.substring(start, end);
    if (selectedText.replace(/\s/g, '').length < 2 || selectedText.length > 800) { clearHighlights(); return; }
    if (!S.pageMap || !S.pageMap.length || !S.pdf) return;
    if (S.contentStart > 0 && start < S.contentStart) { clearHighlights(); return; }

    var page = null, regionStart = 0, regionEnd = 0;
    for (var i = 0; i < S.pageMap.length; i++) {
      if (start >= S.pageMap[i].textStart && start < S.pageMap[i].textEnd) {
        page = S.pageMap[i].page; regionStart = S.pageMap[i].textStart; regionEnd = S.pageMap[i].textEnd; break;
      }
    }
    if (!page) return;

    var matched = findTextItemsOnPage(page, selectedText);
    if (matched.length > 0) { highlightItems(page, matched); return; }

    var regionText = el.editor.value.substring(regionStart, regionEnd);
    var beforeSel = regionText.substring(0, start - regionStart);
    var selLines = (beforeSel.match(/\n/g) || []).length;
    var totalLines = (regionText.match(/\n/g) || []).length + 1;
    var endLine = selLines + (selectedText.match(/\n/g) || []).length + 1;
    highlightRegion(page, selLines / totalLines, Math.min(1, endLine / totalLines));
  } catch (e) { clearHighlights(); }
}

function findTextItemsOnPage(pageNum, editorText) {
  var clean = cleanForMatch(editorText);
  if (clean.length < 2 || !S.pageContentItems) return [];
  var pageData = S.pageContentItems[pageNum - 1];
  if (!pageData || !pageData.items.length) return [];
  var pageClean = pageData.clean, pos = pageClean.indexOf(clean);
  if (pos < 0) {
    for (var len = clean.length - 2; len >= Math.max(3, Math.floor(clean.length * 0.4)); len -= 2) {
      pos = pageClean.indexOf(clean.substring(0, len));
      if (pos >= 0) { clean = clean.substring(0, len); break; }
      pos = pageClean.indexOf(clean.substring(clean.length - len));
      if (pos >= 0) { clean = clean.substring(clean.length - len); break; }
    }
  }
  if (pos < 0) return [];
  var endPos = pos + clean.length, matched = [];
  for (var j = 0; j < pageData.items.length; j++) {
    var it = pageData.items[j];
    if (it.ce > pos && it.cs < endPos) matched.push(it);
  }
  return matched;
}

function cleanForMatch(text) {
  return text
    .replace(/\*\*/g, '').replace(/\*/g, '')
    .replace(/^#{1,6}\s+/gm, '').replace(/^>\s*/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/!$$([^$$]*)\]$$[^)]+$$/g, '')
    .replace(/$$([^$$]*)\]$$[^)]+$$/g, '$1')
    .replace(/`([^`]+)`/g, '$1').replace(/---+/g, '')
    .replace(/^#\w[^\n]*$/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\/\/.*$/gm, '')
    .replace(/$$[^)]*$$/g, '')
    .replace(/[^\u4e00-\u9fff\u3000-\u303fa-zA-Z0-9]/g, '')
    .replace(/\s+/g, '').trim();
}
