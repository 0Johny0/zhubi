/* ================================================================
   editor.js — 编辑、Typst 工具栏、预览、导出
   ================================================================ */

function showEditor() {
  el.dzTxt.style.display = 'none';
  el.txtHead.style.display = 'flex';
  el.mdTbar.style.display = 'flex';
  el.editorArea.style.display = 'flex';
  el.saveGrp.style.display = 'flex';
  el.sepSave.style.display = '';
  el.syncGrp.style.display = 'flex';
  el.sepSync.style.display = '';
  el.textZoomGrp.style.display = 'flex';
  el.sepTz.style.display = '';
}

function updateMeta() {
  var t = el.editor.value;
  el.txtMeta.textContent = t.replace(/\s/g, '').length.toLocaleString() + ' 字 · ' + t.split('\n').length + ' 行';
}

function exportDoc() {
  var t = el.editor.value;
  if (!t.trim()) { toast('没有可导出的内容'); return; }
  var base = S.fname ? S.fname.replace(/\.\w+$/i, '') : '校对';
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([t], { type: 'text/plain;charset=utf-8' }));
  a.download = base + '_校对.typ';
  a.click(); URL.revokeObjectURL(a.href);
  toast('已导出 .typ');
}

function insertAtCursor(text) {
  var ta = el.editor, p = ta.selectionStart;
  ta.value = ta.value.slice(0, p) + text + ta.value.slice(ta.selectionEnd);
  ta.selectionStart = ta.selectionEnd = p + text.length;
  ta.focus();
  updateMeta(); save(); rebuildMap(); schedulePreview();
}

function insertMarker() {
  insertAtCursor('\n// ── 第 ' + S.pg + ' 页 ──\n\n');
}

function setTextZoom(z) {
  S.textScale = Math.max(0.5, Math.min(3, z));
  document.documentElement.style.setProperty('--text-zoom', S.textScale);
  el.textZoomVal.textContent = Math.round(S.textScale * 100) + '%';
}

var previewTimer;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 150);
}

function updatePreview() {
  if (S.mode === 'source') return;
  var lines = el.editor.value.split('\n');
  var html = '';
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (/^\/\/ ── 第 \d+ 页 ──/.test(line)) {
      html += '<h2 class="page-marker">' + escaped + '</h2>';
    } else if (/^\/\/ /.test(line)) {
      html += '<p style="color:var(--muted);font-style:italic">' + escaped + '</p>';
    } else if (/^= /.test(line)) {
      html += '<h1>' + escaped.replace(/^= /, '') + '</h1>';
    } else if (/^== /.test(line)) {
      html += '<h2>' + escaped.replace(/^== /, '') + '</h2>';
    } else if (/^=== /.test(line)) {
      html += '<h3>' + escaped.replace(/^=== /, '') + '</h3>';
    } else if (/^#(import|set|show|let|include|page)\b/.test(line)) {
      html += '<p style="color:#5b7db1;font-family:var(--f-mono);font-size:.82em">' + escaped + '</p>';
    } else if (!line.trim()) {
      html += '<br>';
    } else {
      html += '<p>' + escaped + '</p>';
    }
  }
  el.mdPreview.innerHTML = html;
}

function setMode(m) {
  S.mode = m;
  el.editorArea.className = 'editor-area mode-' + m;
  var btns = el.modeGrp.querySelectorAll('[data-mode]');
  for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].dataset.mode === m);
  if (m === 'preview' || m === 'split') schedulePreview();
  setTimeout(updateVpOverlay, 50);
}

function initToolbar() {
  document.querySelectorAll('.md-tbar [data-md]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var a = btn.dataset.md;
      var sel = el.editor.value.substring(el.editor.selectionStart, el.editor.selectionEnd);
      var wrap = function (pre, suf) { insertAtCursor(pre + sel + suf); };
      switch (a) {
        case 'h1': insertAtCursor('\n= ' + (sel || '标题') + '\n\n'); break;
        case 'h2': insertAtCursor('\n// ── 第 ' + S.pg + ' 页 ──\n\n'); break;
        case 'h3': insertAtCursor('\n=== ' + (sel || '小节') + '\n\n'); break;
        case 'bold': wrap('*', '*'); break;
        case 'italic': wrap('_', '_'); break;
        case 'underline': wrap('#underline[', ']'); break;
        case 'figure': insertAtCursor('\n#figure(\n  image("' + (sel || 'path') + '", width: 80%),\n  caption: [' + (sel || '图注') + '],\n)\n\n'); break;
        case 'table': insertAtCursor('\n#table(\n  columns: 3,\n  table.header([*列1*], [*列2*], [*列3*]),\n  [内容], [内容], [内容],\n)\n\n'); break;
        case 'bib': insertAtCursor('@' + (sel || 'citation-key')); break;
        case 'fn': insertAtCursor('#footnote[' + (sel || '脚注内容') + ']'); break;
        case 'pagebreak': insertAtCursor('\n#pagebreak()\n\n'); break;
        case 'outline': insertAtCursor('\n#outline()\n\n'); break;
      }
    });
  });

  el.modeGrp.querySelectorAll('[data-mode]').forEach(function (btn) {
    btn.addEventListener('click', function () { setMode(btn.dataset.mode); });
  });
}