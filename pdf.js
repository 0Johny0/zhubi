async function loadPDF(fileOrUrl, skipExtract) {
  try {
    var buf, name;
    if (typeof fileOrUrl === 'string') {
      var resp = await fetch(fileOrUrl);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      buf = await resp.arrayBuffer();
      name = decodeURIComponent(fileOrUrl.split('/').pop().split('?')[0]);
    } else {
      buf = await fileOrUrl.arrayBuffer();
      name = fileOrUrl.name;
    }

    console.log('[zhubi] loadPDF:', name, typeof fileOrUrl === 'string' ? '(server)' : '(local)');

    S.pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    S.total = S.pdf.numPages; S.pg = 1; S.fname = name;
    S.savedPageTexts = null; // 重置

    el.dzPdf.style.display = 'none'; el.pdfVp.style.display = 'block';
    el.pgCtrl.style.display = 'flex'; el.sepPg.style.display = '';
    el.zoomGrp.style.display = 'flex'; el.sepCap.style.display = '';
    el.capGrp.style.display = 'flex';
    el.pgTotal.textContent = S.total; el.pgInput.max = S.total;
    el.pgOverlay.classList.add('loaded');

    if (!skipExtract) await fitWidth();
    await buildContinuousLayout();
    S.pageTexts = await cachePageTexts();

    if (!skipExtract) {
      el.editor.value = '';
      var extracted = await extractTextLayer();
      if (extracted) {
        el.editor.value = extracted;
        showEditor(); updateMeta();
        toast('已从 PDF 文本层自动提取，请校对');
      } else {
        showEditor();
        toast('PDF 无文本层，请手动输入 OCR 文本');
      }
    }

    rebuildMap();
    storeSavedTexts(); // 记录已保存状态

    status('已加载 ' + name + ' · ' + S.total + ' 页' + (S.hasTextLayer ? ' · 含文本层' : ''));

    if (S.serverOk && typeof fileOrUrl !== 'string') {
      uploadPDFToServer(fileOrUrl);
    }
  } catch (e) {
    console.error('[zhubi] loadPDF error:', e);
    toast('PDF 加载失败: ' + e.message);
  }
}

async function uploadPDFToServer(file) {
  try {
    var buf = await file.arrayBuffer();
    await fetch('/api/upload-pdf?name=' + encodeURIComponent(file.name), { method: 'POST', body: buf });
  } catch (e) { console.error('[zhubi] upload error:', e); }
}

/* ---- 记录每页已保存的文本 ---- */
function storeSavedTexts() {
  S.savedPageTexts = {};
  if (!S.pageMap || !S.pageMap.length) return;
  for (var i = 0; i < S.pageMap.length; i++) {
    var r = S.pageMap[i];
    S.savedPageTexts[r.page] = el.editor.value.substring(r.textStart, r.textEnd).trim();
  }
  console.log('[zhubi] stored saved texts for', Object.keys(S.savedPageTexts).length, 'pages');
}

/* ---- 对比找出变更页 ---- */
function getChangedPages() {
  var changed = {}, layouts = {};
  if (!S.pageMap || !S.pageMap.length) return { pages: changed, layouts: layouts };

  for (var i = 0; i < S.pageMap.length; i++) {
    var r = S.pageMap[i];
    var current = el.editor.value.substring(r.textStart, r.textEnd).trim();
    var saved = (S.savedPageTexts && S.savedPageTexts[r.page]) || '';

    if (current && current !== saved) {
      changed[String(r.page)] = current;
      var layout = getPageLayout(r.page);
      if (layout) layouts[String(r.page)] = layout;
    }
  }
  return { pages: changed, layouts: layouts };
}

/* ---- 从 pdfjsLib 提取页面布局坐标 ---- */
function getPageLayout(pageNum) {
  if (!S.pageContentItems) return null;
  var pageData = S.pageContentItems[pageNum - 1];
  if (!pageData || !pageData.items.length) return null;

  var items = pageData.items;
  var lineMap = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var y = it.y;
    var found = false;
    for (var j = 0; j < lineMap.length; j++) {
      if (Math.abs(lineMap[j].y - y) < (it.h || 4) * 0.5) {
        lineMap[j].fs_sum += (it.h || 4);
        lineMap[j].count++;
        found = true;
        break;
      }
    }
    if (!found) lineMap.push({ y: y, fs_sum: (it.h || 4), count: 1 });
  }

  lineMap.sort(function (a, b) { return b.y - a.y; });

  var layout = [];
  for (var k = 0; k < lineMap.length; k++) {
    layout.push({
      y: Math.round(lineMap[k].y * 10) / 10,
      fs: Math.round(lineMap[k].fs_sum / lineMap[k].count * 10) / 10
    });
  }
  return layout;
}

/* ---- 写回 PDF ---- */
async function saveAndReload() {
  if (!S.serverOk) { toast('请先启动 python server.py'); return; }
  if (!S.pageMap || !S.pageMap.length) { toast('需要先完成页码映射'); return; }
  if (S._writing) { toast('正在写入中，请勿重复操作'); return; }

  // 只取变更页
  var diff = getChangedPages();
  var pages = diff.pages;
  var layouts = diff.layouts;
  var pageCount = Object.keys(pages).length;

  if (!pageCount) { toast('没有变更内容'); return; }

  console.log('[zhubi] saveAndReload:', S.fname, pageCount, 'changed pages');

  S._writing = true;
  var overlay = $('progressOverlay');
  var bar = $('progressBar');
  var title = $('progressTitle');
  var detail = $('progressDetail');
  if (el.btnWriteBack) el.btnWriteBack.disabled = true;
  if (overlay) overlay.style.display = '';
  if (bar) bar.style.width = '0%';
  if (title) title.textContent = '正在写入 PDF…';
  if (detail) detail.textContent = '变更 ' + pageCount + ' 页，准备中…';

  var beforeUnload = function (e) { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', beforeUnload);

  var pollTimer = setInterval(async function () {
    try {
      var resp = await fetch('/api/progress');
      var data = await resp.json();
      if (data.done !== undefined && data.total) {
        var pct = Math.round(data.done / data.total * 100);
        if (bar) bar.style.width = pct + '%';
        if (detail) detail.textContent = '第 ' + data.done + ' / ' + data.total + ' 页';
      }
      if (data.finished) clearInterval(pollTimer);
    } catch (e) { }
  }, 500);

  try {
    var resp = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: S.fname, pages: pages, layouts: layouts })
    });
    var data = await resp.json();
    console.log('[zhubi] save result:', data);

    clearInterval(pollTimer);

    if (data.error) {
      if (title) title.textContent = '写入失败';
      if (detail) detail.textContent = data.error;
      toast('错误: ' + data.error);
      setTimeout(function () { if (overlay) overlay.style.display = 'none'; }, 4000);
      S._writing = false;
      if (el.btnWriteBack) el.btnWriteBack.disabled = false;
      window.removeEventListener('beforeunload', beforeUnload);
      return;
    }

    // 刷新 PDF
    if (title) title.textContent = '正在刷新…';
    if (bar) bar.style.width = '100%';
    if (detail) detail.textContent = '重新加载 PDF…';

    var pdfUrl = data.url + '?v=' + Date.now();
    var pdfResp = await fetch(pdfUrl);
    if (!pdfResp.ok) throw new Error('PDF reload HTTP ' + pdfResp.status);
    var buf = await pdfResp.arrayBuffer();
    var scrollPos = el.pdfVp.scrollTop;

    S.pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    S.pageTexts = await cachePageTexts();

    for (var j = 0; j < pageSlots.length; j++) {
      pageSlots[j].dataset.rendered = '';
      var cv = pageSlots[j].querySelector('canvas');
      if (cv) { cv.width = 0; cv.height = 0; }
    }
    el.pdfVp.scrollTop = scrollPos;
    renderSlot(S.pg);
    rebuildMap();
    storeSavedTexts(); // 更新已保存状态

    if (title) title.textContent = '写入完成 ✓';
    if (detail) detail.textContent = '已更新 ' + pageCount + ' 页';
    status('写入完成 · ' + pageCount + ' 页');
    toast('PDF 已更新');
    setTimeout(function () { if (overlay) overlay.style.display = 'none'; }, 1500);

  } catch (e) {
    clearInterval(pollTimer);
    console.error('[zhubi] save error:', e);
    if (title) title.textContent = '失败';
    if (detail) detail.textContent = e.message;
    toast('失败: ' + e.message);
    setTimeout(function () { if (overlay) overlay.style.display = 'none'; }, 4000);
  }

  S._writing = false;
  if (el.btnWriteBack) el.btnWriteBack.disabled = false;
  window.removeEventListener('beforeunload', beforeUnload);
}

function exportTextData() {
  if (!S.pageMap || !S.pageMap.length) { toast('需要先完成页码映射'); return; }
  var pages = {};
  for (var i = 0; i < S.pageMap.length; i++) {
    var r = S.pageMap[i];
    var text = el.editor.value.substring(r.textStart, r.textEnd).trim();
    if (text) pages[String(r.page)] = text;
  }
  var json = JSON.stringify(pages, null, 2);
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + json], { type: 'application/json;charset=utf-8' }));
  a.download = (S.fname ? S.fname.replace(/\.\w+$/, '') : 'output') + '_pages.json';
  a.click(); URL.revokeObjectURL(a.href);
  toast('已导出 JSON');
}

async function buildContinuousLayout() {
  var GAP = 14, PAD = 24, top = PAD;
  el.scrollWrap.querySelectorAll('.page-slot').forEach(function (s) { s.remove(); });
  pageSlots.length = 0; pageDims.length = 0;
  for (var i = 1; i <= S.total; i++) {
    var page = await S.pdf.getPage(i);
    var vp = page.getViewport({ scale: 1 });
    var sw = vp.width * S.scale, sh = vp.height * S.scale;
    var slot = document.createElement('div');
    slot.className = 'page-slot'; slot.dataset.page = i;
    slot.style.cssText = 'top:' + top + 'px;width:' + sw + 'px;height:' + sh + 'px';
    var hl = document.createElement('div'); hl.className = 'slot-hl'; slot.appendChild(hl);
    var label = document.createElement('div'); label.className = 'slot-label'; label.textContent = i; slot.appendChild(label);
    el.scrollWrap.appendChild(slot);
    pageSlots.push(slot);
    pageDims.push({ baseW: vp.width, baseH: vp.height, sw: sw, sh: sh, top: top });
    top += sh + GAP;
  }
  el.scrollWrap.style.height = (top + PAD) + 'px';
  el.captureLayer.style.height = el.scrollWrap.style.height;
  setupPageObserver(); updatePgOverlay();
}

function refreshLayout() {
  var GAP = 14, PAD = 24, top = PAD;
  for (var i = 0; i < S.total; i++) {
    var d = pageDims[i];
    d.sw = d.baseW * S.scale; d.sh = d.baseH * S.scale; d.top = top;
    var s = pageSlots[i];
    s.style.top = top + 'px'; s.style.width = d.sw + 'px'; s.style.height = d.sh + 'px';
    var cv = s.querySelector('canvas'); if (cv) { cv.width = 0; cv.height = 0; }
    s.dataset.rendered = ''; top += d.sh + GAP;
  }
  el.scrollWrap.style.height = (top + PAD) + 'px';
  el.captureLayer.style.height = el.scrollWrap.style.height;
}

function setupPageObserver() {
  if (pageObserver) pageObserver.disconnect();
  pageObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) renderSlot(parseInt(e.target.dataset.page)); });
  }, { root: el.pdfVp, rootMargin: '400px 0px' });
  pageSlots.forEach(function (s) { pageObserver.observe(s); });
}

async function renderSlot(n) {
  var slot = pageSlots[n - 1]; if (!slot) return;
  var key = S.scale.toFixed(3); if (slot.dataset.rendered === key) return;
  var page = await S.pdf.getPage(n); var vp = page.getViewport({ scale: S.scale });
  var dpr = devicePixelRatio || 1;
  var cv = slot.querySelector('canvas');
  if (!cv) { cv = document.createElement('canvas'); cv.style.cssText = 'display:block;width:100%;height:100%'; slot.insertBefore(cv, slot.firstChild); }
  cv.width = Math.round(vp.width * dpr); cv.height = Math.round(vp.height * dpr);
  var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  slot.dataset.rendered = key;
}

async function cachePageTexts() {
  var texts = []; S.pageContentItems = [];
  for (var i = 1; i <= S.total; i++) {
    var page = await S.pdf.getPage(i); var content = await page.getTextContent();
    var raw = '', items = [], cleanFull = '';
    for (var k = 0; k < content.items.length; k++) {
      var it = content.items[k]; raw += it.str;
      var c = it.str.replace(/\s+/g, '');
      if (c.length > 0) {
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.max(it.height, 4), cs: cleanFull.length, ce: cleanFull.length + c.length });
        cleanFull += c;
      }
    }
    texts.push(raw); S.pageContentItems.push({ items: items, clean: cleanFull });
  }
  return texts;
}

async function extractTextLayer() {
  var md = '', totalChars = 0;
  for (var i = 1; i <= S.total; i++) {
    var page = await S.pdf.getPage(i); var content = await page.getTextContent();
    if (!content.items.length) continue;
    var items = [];
    for (var k = 0; k < content.items.length; k++) {
      var it = content.items[k];
      if (it.str && it.str.trim()) items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height });
    }
    if (!items.length) continue;
    items.sort(function (a, b) { var dy = b.y - a.y; return Math.abs(dy) > (a.h + b.h) * 0.3 ? dy : a.x - b.x; });
    var lines = [], curLine = [items[0]];
    for (var j = 1; j < items.length; j++) {
      var prev = curLine[curLine.length - 1], curr = items[j];
      if (Math.abs(curr.y - prev.y) > (prev.h + curr.h) / 2 * 0.4) { lines.push(curLine); curLine = [curr]; } else curLine.push(curr);
    }
    if (curLine.length) lines.push(curLine);
    var pageText = '';
    for (var li = 0; li < lines.length; li++) { for (var wi = 0; wi < lines[li].length; wi++) pageText += lines[li][wi].str; pageText += '\n'; }
    pageText = pageText.trim();
    if (pageText.length > 0) { totalChars += pageText.length; md += '// ── 第 ' + i + ' 页 ──\n\n' + pageText + '\n\n'; }
  }
  S.hasTextLayer = (totalChars > S.total * 10);
  return totalChars > 0 ? md.trim() + '\n' : null;
}

function highlightItems(pageNum, items) {
  clearHighlights();
  if (!items.length || pageNum < 1 || pageNum > pageDims.length) return;
  var slot = pageSlots[pageNum - 1]; var container = slot.querySelector('.slot-hl'); if (!container) return;
  var d = pageDims[pageNum - 1], pw = d.baseW, ph = d.baseH;
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var left = it.x / pw * 100, top = (ph - it.y - it.h) / ph * 100;
    var width = it.w / pw * 100, height = it.h / ph * 100;
    if (width < 0.3 || height < 0.2) continue;
    var rect = document.createElement('div'); rect.className = 'hl-rect';
    rect.style.cssText = 'left:' + left + '%;top:' + top + '%;width:' + width + '%;height:' + height + '%;';
    container.appendChild(rect);
  }
}

function highlightRegion(pageNum, startPct, endPct) {
  clearHighlights();
  if (pageNum < 1 || pageNum > pageDims.length) return;
  var slot = pageSlots[pageNum - 1]; var container = slot.querySelector('.slot-hl'); if (!container) return;
  var top = startPct * 100, height = Math.max(2, (endPct - startPct) * 100);
  var rect = document.createElement('div'); rect.className = 'hl-rect hl-rect--approx';
  rect.style.cssText = 'left:2%;top:' + top + '%;width:96%;height:' + height + '%;';
  container.appendChild(rect);
}

function clearHighlights() {
  for (var i = 0; i < pageSlots.length; i++) { var c = pageSlots[i].querySelector('.slot-hl'); if (c) c.innerHTML = ''; }
}

function calcPage() {
  if (!pageDims.length) return 1;
  var c = el.pdfVp.scrollTop + el.pdfVp.clientHeight * 0.35, p = 1;
  for (var i = 0; i < pageDims.length; i++) { if (c >= pageDims[i].top + pageDims[i].sh / 2) p = i + 2; }
  return Math.min(p, S.total);
}
function updatePgOverlay() { el.pgOverlay.textContent = '第 ' + S.pg + ' / ' + S.total + ' 页'; }

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

async function fitWidth() {
  if (!S.pdf) return;
  var p = await S.pdf.getPage(1);
  S.scale = Math.max(0.25, (el.pdfVp.clientWidth - 56) / p.getViewport({ scale: 1 }).width);
}
function zoomTo(ns) {
  var old = S.scale, ratio = ns / old;
  var st = el.pdfVp.scrollTop, vh = el.pdfVp.clientHeight, ctr = st + vh / 2;
  S.scale = Math.max(0.2, Math.min(6, ns));
  refreshLayout(); setupPageObserver();
  el.pdfVp.scrollTop = ctr * ratio - vh / 2;
  el.zoomVal.textContent = Math.round(S.scale * 100) + '%';
}

function toggleCapture() {
  S.captureMode = !S.captureMode;
  el.captureLayer.classList.toggle('active', S.captureMode);
  $('btnCapture').classList.toggle('btn--active', S.captureMode);
  el.capBadge.classList.toggle('show', S.captureMode);
  toast(S.captureMode ? '截取模式已开启' : '已退出截取模式');
}
function initCapture() {
  var ov = el.captureLayer, rect = el.captureRect;
  ov.addEventListener('mousedown', function (e) {
    if (!S.captureMode) return;
    var r = el.scrollWrap.getBoundingClientRect();
    S.capStart = { x: e.clientX - r.left, y: e.clientY - r.top, r: r };
    rect.style.display = 'block';
    rect.style.left = S.capStart.x + 'px'; rect.style.top = S.capStart.y + 'px';
    rect.style.width = '0px'; rect.style.height = '0px'; e.preventDefault();
  });
  ov.addEventListener('mousemove', function (e) {
    if (!S.capStart) return;
    var r = S.capStart.r, x = e.clientX - r.left, y = e.clientY - r.top;
    rect.style.left = Math.min(S.capStart.x, x) + 'px'; rect.style.top = Math.min(S.capStart.y, y) + 'px';
    rect.style.width = Math.abs(x - S.capStart.x) + 'px'; rect.style.height = Math.abs(y - S.capStart.y) + 'px';
  });
  ov.addEventListener('mouseup', function (e) {
    if (!S.capStart) return;
    var r = S.capStart.r, x = e.clientX - r.left, y = e.clientY - r.top;
    var x1 = Math.min(S.capStart.x, x), y1 = Math.min(S.capStart.y, y);
    var w = Math.abs(x - S.capStart.x), h = Math.abs(y - S.capStart.y);
    S.capStart = null; rect.style.display = 'none';
    if (w < 10 || h < 10) return; doCapture(x1, y1, w, h);
  });
}
function doCapture(cx, cy, cw, ch) {
  for (var i = 0; i < pageDims.length; i++) {
    var d = pageDims[i];
    if (cy + ch > d.top && cy < d.top + d.sh) {
      var slotW = d.sw, slotLeft = (el.scrollWrap.clientWidth - slotW) / 2;
      var rx = Math.max(0, cx - slotLeft), ry = Math.max(0, cy - d.top);
      var rw = Math.min(slotW - rx, cw), rh = Math.min(d.sh - ry, ch);
      if (rw <= 0 || rh <= 0) continue;
      var cv = pageSlots[i].querySelector('canvas'); if (!cv) continue;
      var dpr = devicePixelRatio || 1;
      var ow = Math.round(rw), oh = Math.round(rh);
      if (ow > 1200) { var ratio = 1200 / ow; ow = 1200; oh = Math.round(oh * ratio); }
      var tc = document.createElement('canvas'); tc.width = ow; tc.height = oh;
      tc.getContext('2d').drawImage(cv, rx * dpr, ry * dpr, rw * dpr, rh * dpr, 0, 0, ow, oh);
      insertAtCursor('\n![截图-第' + (i + 1) + '页](' + tc.toDataURL('image/jpeg', 0.82) + ')\n\n');
      toast('已截取第 ' + (i + 1) + ' 页图片');
      if (S.mode === 'source') setMode('split'); return;
    }
  }
}
