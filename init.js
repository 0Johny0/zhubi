/* ================================================================
   init.js — 事件绑定、拖放、分栏、文件列表、服务器检测、启动
   ================================================================ */

function initDrop(zone, input, accept, handler) {
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
el.splitHandle.addEventListener('mousedown', function (e) {
  splitDrag = true; document.body.style.cursor = 'row-resize';
  document.body.style.userSelect = 'none'; e.preventDefault();
});
el.resizer.addEventListener('mousedown', function (e) {
  resizing = true; el.resizer.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none'; e.preventDefault();
});
document.addEventListener('mousemove', function (e) {
  if (splitDrag) {
    var r = el.editorArea.getBoundingClientRect();
    el.mdSource.style.flex = '0 0 ' + Math.max(15, Math.min(85, (e.clientY - r.top) / r.height * 100)) + '%';
  }
  if (resizing) {
    var r2 = document.querySelector('.workspace').getBoundingClientRect();
    var p = Math.max(0.2, Math.min(0.8, (e.clientX - r2.left) / r2.width));
    el.pdfPanel.style.flex = p; el.textPanel.style.flex = 1 - p;
  }
});
document.addEventListener('mouseup', function () {
  if (splitDrag) { splitDrag = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; el.mdSource.style.flex = ''; }
  if (resizing) { resizing = false; el.resizer.classList.remove('active'); document.body.style.cursor = ''; document.body.style.userSelect = ''; }
});

/* ---- 工具栏 ---- */
el.pdfInput.addEventListener('change', function (e) { if (e.target.files[0]) loadPDF(e.target.files[0]); e.target.value = ''; });
$('btnPdf').addEventListener('click', function () { el.pdfInput.click(); });
$('btnPrev').addEventListener('click', function () { go(-1); });
$('btnNext').addEventListener('click', function () { go(1); });

el.pgInput.addEventListener('change', function () {
  var n = Math.max(1, Math.min(S.total, parseInt(el.pgInput.value) || 1));
  lockSync(1000); scrollToPageNum(n); scrollToTextPage(n);
});

$('btnZin').addEventListener('click', function () { zoomTo(S.scale + 0.2); });
$('btnZout').addEventListener('click', function () { zoomTo(S.scale - 0.2); });
$('btnFit').addEventListener('click', async function () { await fitWidth(); zoomTo(S.scale); });
$('btnTZin').addEventListener('click', function () { setTextZoom(S.textScale + 0.1); });
$('btnTZout').addEventListener('click', function () { setTextZoom(S.textScale - 0.1); });
$('btnTFit').addEventListener('click', function () { setTextZoom(1); });
$('btnMarker').addEventListener('click', insertMarker);
$('btnCapture').addEventListener('click', toggleCapture);
$('btnSave').addEventListener('click', exportDoc);
$('btnExportJson').addEventListener('click', exportTextData);
$('btnWriteBack').addEventListener('click', saveAndReload);

$('btnSync').addEventListener('click', function () {
  S.syncOn = !S.syncOn;
  el.btnSync.className = S.syncOn ? 'btn btn--sm btn--active' : 'btn btn--sm';
  el.btnSync.textContent = S.syncOn ? '🔗 同步' : '🔓 同步';
  toast(S.syncOn ? '同步已开启' : '同步已关闭');
});

/* ---- 文件列表 ---- */
async function loadFileList() {
  if (!S.serverOk) return;
  el.fpBody.innerHTML = '<div class="fp-empty">加载中…</div>';
  try {
    var resp = await fetch('/api/files');
    var data = await resp.json();
    if (data.error) { el.fpBody.innerHTML = '<div class="fp-empty">' + data.error + '</div>'; return; }
    if (!data.files.length) {
      el.fpBody.innerHTML = '<div class="fp-empty">📂 /app/data/ 下没有 PDF 文件</div>';
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
  } catch (e) { el.fpBody.innerHTML = '<div class="fp-empty">获取失败</div>'; }
}

function showFilePicker() {
  el.filePicker.style.display = '';
  loadFileList();
}

$('btnFileList').addEventListener('click', showFilePicker);
$('fpClose').addEventListener('click', function () { el.filePicker.style.display = 'none'; });

/* ---- 编辑器事件 ---- */
var _inputRebuildTimer;
el.editor.addEventListener('input', function () {
  updateMeta(); save(); schedulePreview(); clearHighlights();
  clearTimeout(_inputRebuildTimer);
  _inputRebuildTimer = setTimeout(rebuildMap, 500);
});

el.editor.addEventListener('mouseup', function () { debouncedHighlight(); });
document.addEventListener('selectionchange', function () {
  if (document.activeElement === el.editor) debouncedHighlight();
});

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
el.mdPreview.addEventListener('scroll', updateVpOverlay);
el.pdfVp.addEventListener('scroll', onPdfScroll);

el.pdfVp.addEventListener('wheel', function (e) {
  if (e.ctrlKey) { e.preventDefault(); zoomTo(S.scale + (e.deltaY > 0 ? -0.12 : 0.12)); }
}, { passive: false });
el.textPanel.addEventListener('wheel', function (e) {
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
el.pdfPanel.addEventListener('dragover', function (e) { e.preventDefault(); });
el.pdfPanel.addEventListener('drop', function (e) {
  e.preventDefault();
  var f = e.dataTransfer.files[0];
  if (f && /\.pdf$/i.test(f.name)) loadPDF(f);
  else if (f) toast('请拖入 PDF 文件');
});
el.textPanel.addEventListener('dragover', function (e) { e.preventDefault(); });
el.textPanel.addEventListener('drop', function (e) {
  e.preventDefault();
  var f = e.dataTransfer.files[0];
  if (f && /\.pdf$/i.test(f.name)) loadPDF(f);
  else if (f) toast('请拖入 PDF 文件');
});

el.dzTxt.addEventListener('click', function () { el.pdfInput.click(); });

/* ---- 服务器检测 ---- */
async function detectServer() {
  try {
    var resp = await fetch('/api/status', { signal: AbortSignal.timeout(1500) });
    var data = await resp.json();
    if (data.ok) {
      S.serverOk = true;
      el.btnWriteBack.style.display = '';
      el.btnFileList.style.display = '';
      toast('已连接本地服务');
    }
  } catch (e) {
    S.serverOk = false;
    el.btnWriteBack.style.display = 'none';
    el.btnFileList.style.display = 'none';
  }
}

/* ---- 启动 ---- */
initDrop(el.dzPdf, el.pdfInput, /\.pdf$/i, loadPDF);
initToolbar(); initCapture(); restore(); detectServer();
