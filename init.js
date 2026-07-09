function initDrop(zone, input, accept, handler) {
  if (!zone || !input) return;
  var stop = function (e) { e.preventDefault(); e.stopPropagation(); };
  zone.addEventListener('dragenter', function (e) { stop(e); zone.classList.add('over'); });
  zone.addEventListener('dragover', function (e) { stop(e); zone.classList.add('over'); });
  zone.addEventListener('dragleave', function (e) { stop(e); zone.classList.remove('over'); });
  zone.addEventListener('drop', function (e) {
    stop(e); zone.classList.remove('over');
    var f = e.dataTransfer.files[0];
    if (f && (!accept || accept.test(f.name))) handler(f);
    else if (f) toast('格式不匹配');
  });
  zone.addEventListener('click', function () { input.click(); });
}

/* ---- 分栏拖拽 ---- */
var splitDrag = false, resizing = false;

if (el.splitHandle) {
  el.splitHandle.addEventListener('mousedown', function (e) {
    splitDrag = true; document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none'; e.preventDefault();
  });
}
if (el.resizer) {
  el.resizer.addEventListener('mousedown', function (e) {
    resizing = true; el.resizer.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none'; e.preventDefault();
  });
}
document.addEventListener('mousemove', function (e) {
  if (splitDrag && el.editorArea && el.mdSource) {
    var r = el.editorArea.getBoundingClientRect();
    el.mdSource.style.flex = '0 0 ' + Math.max(15, Math.min(85, (e.clientY - r.top) / r.height * 100)) + '%';
  }
  if (resizing) {
    var r2 = document.querySelector('.workspace').getBoundingClientRect();
    var p = Math.max(0.2, Math.min(0.8, (e.clientX - r2.left) / r2.width));
    if (el.pdfPanel) el.pdfPanel.style.flex = p;
    if (el.textPanel) el.textPanel.style.flex = 1 - p;
  }
});
document.addEventListener('mouseup', function () {
  if (splitDrag) { splitDrag = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; if (el.mdSource) el.mdSource.style.flex = ''; }
  if (resizing) { resizing = false; if (el.resizer) el.resizer.classList.remove('active'); document.body.style.cursor = ''; document.body.style.userSelect = ''; }
});

/* ---- 工具栏 ---- */
if (el.pdfInput) el.pdfInput.addEventListener('change', function (e) { if (e.target.files[0]) loadPDF(e.target.files[0]); e.target.value = ''; });

var _btn = function (id, fn) { var b = $(id); if (b) b.addEventListener('click', fn); };

_btn('btnPdf', function () { if (el.pdfInput) el.pdfInput.click(); });
_btn('btnPrev', function () { go(-1); });
_btn('btnNext', function () { go(1); });

if (el.pgInput) el.pgInput.addEventListener('change', function () {
  var n = Math.max(1, Math.min(S.total, parseInt(el.pgInput.value) || 1));
  lockSync(1000); scrollToPageNum(n); scrollToTextPage(n);
});

_btn('btnZin', function () { zoomTo(S.scale + 0.2); });
_btn('btnZout', function () { zoomTo(S.scale - 0.2); });
_btn('btnFit', async function () { await fitWidth(); zoomTo(S.scale); });
_btn('btnTZin', function () { setTextZoom(S.textScale + 0.1); });
_btn('btnTZout', function () { setTextZoom(S.textScale - 0.1); });
_btn('btnTFit', function () { setTextZoom(1); });
_btn('btnMarker', function () { insertMarker(); });
_btn('btnCapture', function () { toggleCapture(); });
_btn('btnSave', function () { exportDoc(); });
_btn('btnExportJson', function () { exportTextData(); });
_btn('btnWriteBack', function () { saveAndReload(); });
_btn('btnFileList', function () { showFilePicker(); });
_btn('fpClose', function () { if (el.filePicker) el.filePicker.style.display = 'none'; });

_btn('btnSync', function () {
  S.syncOn = !S.syncOn;
  if (el.btnSync) {
    el.btnSync.className = S.syncOn ? 'btn btn--sm btn--active' : 'btn btn--sm';
    el.btnSync.textContent = S.syncOn ? '🔗 同步' : '🔓 同步';
  }
  toast(S.syncOn ? '同步已开启' : '同步已关闭');
});

/* ---- 编辑器事件 ---- */
if (el.editor) {
  var _inputRebuildTimer;
  el.editor.addEventListener('input', function () {
    updateMeta(); save(); schedulePreview(); clearHighlights();
    clearTimeout(_inputRebuildTimer);
    _inputRebuildTimer = setTimeout(rebuildMap, 500);
  });

  el.editor.addEventListener('mouseup', function () { debouncedHighlight(); });

  var _clickSync;
  el.editor.addEventListener('click', function () {
    clearTimeout(_clickSync);
    _clickSync = setTimeout(function () {
      if (el.editor.selectionStart === el.editor.selectionEnd) syncFromEditor();
    }, 150);
  });

  el.editor.addEventListener('keyup', function (e) {
    if (e.shiftKey) { debouncedHighlight(); return; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].indexOf(e.key) >= 0) {
      if (el.editor.selectionStart === el.editor.selectionEnd) syncFromEditor();
    }
  });

  el.editor.addEventListener('scroll', function () {
    updateVpOverlay();
    if (S.syncLock) return;
    clearTimeout(_edScrollTimer);
    _edScrollTimer = setTimeout(syncFromEditorScroll, 200);
  });
}

document.addEventListener('selectionchange', function () {
  if (document.activeElement === el.editor) debouncedHighlight();
});

if (el.mdPreview) el.mdPreview.addEventListener('scroll', updateVpOverlay);
if (el.pdfVp) el.pdfVp.addEventListener('scroll', onPdfScroll);

if (el.pdfVp) el.pdfVp.addEventListener('wheel', function (e) {
  if (e.ctrlKey) { e.preventDefault(); zoomTo(S.scale + (e.deltaY > 0 ? -0.12 : 0.12)); }
}, { passive: false });
if (el.textPanel) el.textPanel.addEventListener('wheel', function (e) {
  if (e.ctrlKey) { e.preventDefault(); setTextZoom(S.textScale + (e.deltaY > 0 ? -0.05 : 0.05)); }
}, { passive: false });

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && S.captureMode) toggleCapture();
  var inEd = (document.activeElement === el.editor);
  if (e.key === 'ArrowLeft' && !inEd && !S.captureMode) { e.preventDefault(); go(-1); }
  if (e.key === 'ArrowRight' && !inEd && !S.captureMode) { e.preventDefault(); go(1); }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveAndReload(); }
});

/* ---- 面板拖放 ---- */
if (el.pdfPanel) {
  el.pdfPanel.addEventListener('dragover', function (e) { e.preventDefault(); });
  el.pdfPanel.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer.files[0];
    if (f && /\.pdf$/i.test(f.name)) loadPDF(f);
    else if (f) toast('请拖入 PDF 文件');
  });
}
if (el.textPanel) {
  el.textPanel.addEventListener('dragover', function (e) { e.preventDefault(); });
  el.textPanel.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer.files[0];
    if (f && /\.pdf$/i.test(f.name)) loadPDF(f);
    else if (f) toast('请拖入 PDF 文件');
  });
}

if (el.dzTxt) el.dzTxt.addEventListener('click', function () { if (el.pdfInput) el.pdfInput.click(); });

/* ---- 文件列表 ---- */
async function loadFileList() {
  if (!S.serverOk || !el.fpBody) return;
  el.fpBody.innerHTML = '<div class="fp-empty">加载中…</div>';
  try {
    var resp = await fetch('/api/files');
    var data = await resp.json();
    if (data.error) { el.fpBody.innerHTML = '<div class="fp-empty">错误: ' + data.error + '</div>'; return; }

    if (!data.files.length) {
      el.fpBody.innerHTML = '<div class="fp-empty">📂 没有 PDF 文件</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < data.files.length; i++) {
      var f = data.files[i];
      var date = new Date(f.mtime * 1000);
      var ds = (date.getMonth() + 1) + '/' + date.getDate() + ' ' +
               date.getHours().toString().padStart(2, '0') + ':' +
               date.getMinutes().toString().padStart(2, '0');
      html += '<div class="fp-item" data-name="' + f.name + '">' +
              '<span class="fp-name">📄 ' + f.name + '</span>' +
              '<span class="fp-size">' + f.size + ' MB</span>' +
              '<span class="fp-date">' + ds + '</span></div>';
    }
    el.fpBody.innerHTML = html;

    el.fpBody.querySelectorAll('.fp-item').forEach(function (item) {
      item.addEventListener('click', function () {
        el.filePicker.style.display = 'none';
        loadPDF('/data/' + encodeURIComponent(item.dataset.name));
      });
    });
  } catch (e) {
    el.fpBody.innerHTML = '<div class="fp-empty">获取失败: ' + e.message + '</div>';
  }
}

function showFilePicker() {
  if (el.filePicker) {
    el.filePicker.style.display = '';
    loadFileList();
  }
}

/* ---- 服务器检测 ---- */
async function detectServer() {
  try {
    var resp = await fetch('/api/status', { signal: AbortSignal.timeout(2000) });
    var data = await resp.json();
    if (data.ok) {
      S.serverOk = true;
      if (el.btnWriteBack) el.btnWriteBack.style.display = '';
      if (el.btnFileList) el.btnFileList.style.display = '';
      toast('已连接本地服务');
    }
  } catch (e) {
    S.serverOk = false;
    if (el.btnWriteBack) el.btnWriteBack.style.display = 'none';
    if (el.btnFileList) el.btnFileList.style.display = 'none';
  }
}

/* ---- 启动 ---- */
initDrop(el.dzPdf, el.pdfInput, /\.pdf$/i, loadPDF);
initToolbar(); initCapture(); restore(); detectServer();
