if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

var S = {
  pdf: null, pg: 1, total: 0, scale: 1.5, fname: '',
  textScale: 1, hasTextLayer: false,
  pageMap: null, isEstimate: false,
  syncOn: true, syncLock: false,
  captureMode: false, capStart: null, mode: 'source',
  pageTexts: null, pageContentItems: null,
  contentStart: 0,
  serverOk: false
};

var pageSlots = [], pageDims = [], pageObserver = null;

function $(id) { return document.getElementById(id); }

var el = {
  pdfInput: $('pdfInput'),
  dzPdf: $('dzPdf'), dzTxt: $('dzTxt'),
  pdfVp: $('pdfVp'), scrollWrap: $('scrollWrap'),
  captureLayer: $('captureLayer'), captureRect: $('captureRect'),
  capBadge: $('capBadge'),
  pgCtrl: $('pgCtrl'), pgInput: $('pgInput'), pgTotal: $('pgTotal'),
  pgOverlay: $('pgOverlay'), syncBanner: $('syncBanner'),
  zoomGrp: $('zoomGrp'), zoomVal: $('zoomVal'),
  sepTz: document.querySelector('.sep-tz'),
  textZoomGrp: $('textZoomGrp'), textZoomVal: $('textZoomVal'),
  capGrp: $('capGrp'), syncGrp: $('syncGrp'), mapInfo: $('mapInfo'),
  btnSync: $('btnSync'), saveGrp: $('saveGrp'),
  txtHead: $('txtHead'), txtMeta: $('txtMeta'), mdTbar: $('mdTbar'),
  editorArea: $('editorArea'), mdSource: $('mdSource'), editor: $('editor'),
  splitHandle: $('splitHandle'),
  mdPreviewPane: $('mdPreviewPane'), mdPreview: $('mdPreview'),
  pageStrip: $('pageStrip'),
  toast: $('toast'), statusR: $('statusR'),
  resizer: $('resizer'), pdfPanel: $('pdfPanel'), textPanel: $('textPanel'),
  modeGrp: $('modeGrp'),
  btnWriteBack: $('btnWriteBack'), btnExportJson: $('btnExportJson'),
  sepPg: document.querySelector('.sep-pg'),
  sepCap: document.querySelector('.sep-cap'),
  sepSync: document.querySelector('.sep-sync'),
  sepSave: document.querySelector('.sep-save')
};

var toastT;
function toast(m) {
  el.toast.textContent = m; el.toast.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(function () { el.toast.classList.remove('show'); }, 2200);
}
function status(m) { el.statusR.textContent = m; }

var SAVE_KEY = 'zhubi_pref_v4';
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ts: S.textScale })); } catch (e) { }
}
function restore() {
  try {
    var d = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (d && d.ts) setTextZoom(d.ts);
  } catch (e) { }
}

el.editorArea.className = 'editor-area mode-source';
var _sb = el.modeGrp.querySelector('[data-mode="source"]');
var _xb = el.modeGrp.querySelector('[data-mode="split"]');
if (_sb) _sb.classList.add('active');
if (_xb) _xb.classList.remove('active');