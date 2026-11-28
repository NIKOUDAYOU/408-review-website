// 英语阅读 · 本地 PDF 解析与智能拆文章引擎（兼容 file:// 打开，无需后端）
// 核心能力：
// 1. 按需加载 pdf.js (v3.11.174 UMD + 预载 pdf.worker 到 globalThis.pdfjsWorker，兼容 file:// 无 Worker 跨域报错)
// 2. 基于真实 PDF 坐标（X/Y/字号/旋转矩阵）还原阅读顺序：自动过滤斜向水印、页眉页脚、自动识别单栏/双栏、按缩进与行距准确分段、自动消除跨行连字符、跨页拼接断段
// 3. 三种拆分策略：考研真题（自动拆 Text 1~4 / 完形 / 新题型 / 翻译，可选剔除选择题题干或附到笔记）、外刊多篇（按大字号标题/Passage/Unit 拆篇）、整份合并/按页拆篇
// 4. 提供预览与微调工作台，勾选后一键批量导入独立阅读库

const PDFJS_CDN_PAIRS = [
  {
    lib: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    worker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
    standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/'
  },
  {
    lib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    worker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    cMapUrl: '',
    standardFontDataUrl: ''
  },
  {
    lib: 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js',
    worker: 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    cMapUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/cmaps/',
    standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@3.11.174/standard_fonts/'
  }
];

let pdfJsLoadPromise = null;
let pdfJsActiveCdn = null;

// 工作台运行态
const pdfImportState = {
  fileName: '',
  arrayBuffer: null,
  numPages: 0,
  pageRange: '',
  mode: 'auto',              // auto | kaoyan | multi | single | perpage
  stripQuestions: true,      // 考研模式：从正文剔除 21~40 选择题题干与选项
  attachQuestionsToNote: false, // 是否把拆出的题干附到文章总结笔记里
  cleanHeaders: true,        // 自动过滤页眉页脚与斜向水印
  rawPages: [],              // [{ pageNum, lines: [{ text, x, right, y, fontSize, isCentered, col }] }]
  articles: [],              // [{ id, checked, title, source, topic, tag, pages, paragraphs: [str], questionsText }]
  selectedIdx: 0,
  parsing: false,
  detectedMode: 'kaoyan',
  error: '',
  warning: ''
};

// =========================================================================
// 1. 按需加载 pdf.js（兼容 file:// 协议）
// =========================================================================
function loadScriptOnce(src, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-pdfsrc="${src}"]`);
    if (existing && existing.dataset.loaded === '1') { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.dataset.pdfsrc = src;
    const timer = setTimeout(() => { s.remove(); reject(new Error('加载超时: ' + src)); }, timeoutMs);
    s.onload = () => { clearTimeout(timer); s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error('脚本加载失败: ' + src)); };
    document.head.appendChild(s);
  });
}

async function ensurePdfJsLoaded() {
  if (window.pdfjsLib && window.pdfjsLib.getDocument) return window.pdfjsLib;
  if (pdfJsLoadPromise) return pdfJsLoadPromise;

  pdfJsLoadPromise = (async () => {
    let lastErr = null;
    for (const cdn of PDFJS_CDN_PAIRS) {
      try {
        await loadScriptOnce(cdn.lib);
        // 在 file:// 下直接用 <script> 预载 worker，pdf.js 降级 fake worker 时会直接复用 globalThis.pdfjsWorker.WorkerMessageHandler，彻底规避跨域 Worker 报错
        await loadScriptOnce(cdn.worker);
        if (window.pdfjsLib && window.pdfjsLib.getDocument) {
          if (location.protocol !== 'file:') {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = cdn.worker;
          } else {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = '';
          }
          pdfJsActiveCdn = cdn;
          return window.pdfjsLib;
        }
      } catch (err) {
        lastErr = err;
      }
    }
    pdfJsLoadPromise = null;
    throw new Error('PDF 解析引擎加载失败（请检查网络连接后重试）：' + (lastErr ? lastErr.message : ''));
  })();

  return pdfJsLoadPromise;
}

// =========================================================================
// 2. 页码范围解析（支持 "1-10", "1,3,5-8", 空=全部）
// =========================================================================
function parsePdfPageRange(spec, numPages) {
  const s = String(spec || '').trim();
  if (!s) {
    const all = [];
    for (let i = 1; i <= numPages; i++) all.push(i);
    return all;
  }
  const set = new Set();
  const parts = s.replace(/[，、；;]/g, ',').split(',');
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const m = p.match(/^(\d+)\s*[-~–—]\s*(\d+)$/);
    if (m) {
      const a = Math.max(1, Math.min(numPages, parseInt(m[1], 10)));
      const b = Math.max(1, Math.min(numPages, parseInt(m[2], 10)));
      const lo = Math.min(a, b), hi = Math.max(a, b);
      for (let k = lo; k <= hi; k++) set.add(k);
    } else if (/^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      if (n >= 1 && n <= numPages) set.add(n);
    }
  }
  const list = [...set].sort((a, b) => a - b);
  return list.length ? list : Array.from({ length: numPages }, (_, i) => i + 1);
}

// =========================================================================
// 3. 坐标级页面行还原（过滤旋转水印 / 页眉页脚 / 识别双栏）
// =========================================================================
function extractPageLines(textContent, viewport, cleanHeaders) {
  const pageW = viewport.width || 595;
  const pageH = viewport.height || 842;
  const rawItems = [];

  for (const item of (textContent.items || [])) {
    if (!item || typeof item.str !== 'string') continue;
    const str = item.str;
    if (!str.trim()) continue;
    const tr = item.transform || [12, 0, 0, 12, 0, 0];
    // 过滤斜向旋转水印（如 45° 机构水印：skew 分量显著大于 0）
    if (cleanHeaders && (Math.abs(tr[1]) > 0.25 || Math.abs(tr[2]) > 0.25)) continue;

    const fontSize = Math.max(6, Math.hypot(tr[0], tr[1]) || Math.abs(tr[3]) || item.height || 10);
    const x = tr[4];
    const y = tr[5]; // PDF 原点在左下角，y 越大越靠上
    const w = Math.max(0, Number(item.width) || (str.length * fontSize * 0.45));

    // 过滤极顶部/极底部的纯页码（如 "- 3 -", "第 3 页", "3 / 12", 单独数字）
    if (cleanHeaders && (y < pageH * 0.065 || y > pageH * 0.945)) {
      const t = str.trim();
      if (/^[-—–\s·]*\d{1,4}\s*(?:\/\s*\d{1,4})?[-—–\s·]*$/.test(t) || /^第\s*\d+\s*页/.test(t) || /^Page\s+\d+/i.test(t)) {
        continue;
      }
    }

    rawItems.push({ str, x, y, right: x + w, width: w, fontSize });
  }

  if (!rawItems.length) return { pageW, pageH, lines: [], bodyFontSize: 11 };

  // 估算正文字号（按字符数加权中位数）
  const sizeCounts = new Map();
  for (const it of rawItems) {
    const bucket = Math.round(it.fontSize * 2) / 2;
    sizeCounts.set(bucket, (sizeCounts.get(bucket) || 0) + it.str.trim().length);
  }
  let bodyFontSize = 11, maxWeight = -1;
  for (const [sz, wt] of sizeCounts.entries()) {
    if (wt > maxWeight) { maxWeight = wt; bodyFontSize = sz; }
  }

  // 检测双栏：检查中缝 (43%~57% 页宽) 是否几乎没有正文块横跨，且左右两栏文字量都足够
  const midX = pageW * 0.5;
  const gutterLo = pageW * 0.44;
  const gutterHi = pageW * 0.56;
  let leftChars = 0, rightChars = 0, crossChars = 0;
  for (const it of rawItems) {
    const len = it.str.trim().length;
    if (it.right < midX + pageW * 0.02) leftChars += len;
    else if (it.x > midX - pageW * 0.02) rightChars += len;
    else if (it.x < gutterLo && it.right > gutterHi) crossChars += len;
  }
  const totalChars = leftChars + rightChars + crossChars;
  const isTwoCol = totalChars > 180
    && leftChars > totalChars * 0.26
    && rightChars > totalChars * 0.26
    && crossChars < totalChars * 0.12;

  const groupToLines = (items, colIdx) => {
    if (!items.length) return [];
    const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
    const groups = [];
    for (const it of sorted) {
      let placed = false;
      for (let i = groups.length - 1; i >= Math.max(0, groups.length - 4); i--) {
        const g = groups[i];
        const tol = Math.max(3.2, Math.min(g.fontSize, it.fontSize) * 0.45);
        if (Math.abs(g.y - it.y) <= tol) {
          g.items.push(it);
          placed = true;
          break;
        }
      }
      if (!placed) groups.push({ y: it.y, fontSize: it.fontSize, items: [it] });
    }

    groups.sort((a, b) => b.y - a.y);
    return groups.map(g => {
      g.items.sort((a, b) => a.x - b.x);
      let text = '';
      let prev = null;
      let maxFs = 0;
      for (const it of g.items) {
        if (it.fontSize > maxFs) maxFs = it.fontSize;
        const s = it.str;
        if (!prev) {
          text = s;
        } else {
          const gap = it.x - prev.right;
          const avgChar = Math.max(3, prev.fontSize * 0.42);
          const needSpace = gap > avgChar * 0.28
            && !/\s$/.test(text)
            && !/^\s/.test(s)
            && !/[-—(\[“‘\/]$/.test(text)
            && !/^[,.;:!?)\]"”’]/.test(s);
          text += (needSpace ? ' ' : '') + s;
        }
        prev = it;
      }
      text = text.replace(/\s+/g, ' ').trim();
      const firstX = g.items[0].x;
      const lastRight = g.items[g.items.length - 1].right;
      const center = (firstX + lastRight) / 2;
      const isCentered = Math.abs(center - pageW / 2) < pageW * 0.08 && (lastRight - firstX) < pageW * 0.72;
      return {
        text,
        x: firstX,
        right: lastRight,
        width: lastRight - firstX,
        y: g.y,
        fontSize: maxFs || bodyFontSize,
        isCentered,
        col: colIdx
      };
    }).filter(l => l.text);
  };

  let lines;
  if (isTwoCol) {
    // 跨栏通栏标题按 y 位置保留，其余分左右两栏
    const spanItems = [];
    const leftItems = [];
    const rightItems = [];
    for (const it of rawItems) {
      if (it.x < gutterLo && it.right > gutterHi) spanItems.push(it);
      else if ((it.x + it.right) / 2 < midX) leftItems.push(it);
      else rightItems.push(it);
    }
    const spanLines = groupToLines(spanItems, 0);
    const leftLines = groupToLines(leftItems, 1);
    const rightLines = groupToLines(rightItems, 2);
    // 通栏行如果在页面顶部，放最前面；其余按左栏→右栏顺序
    const topSpans = spanLines.filter(l => l.y > pageH * 0.72);
    const otherSpans = spanLines.filter(l => l.y <= pageH * 0.72);
    lines = [...topSpans, ...leftLines, ...rightLines, ...otherSpans];
  } else {
    lines = groupToLines(rawItems, 0);
  }

  return { pageW, pageH, lines, bodyFontSize, isTwoCol };
}

// 过滤跨多页重复出现的固定页眉/页脚文本（如试卷名称、公众号水印、网址）
function stripRepeatedRunningLines(rawPages) {
  if (rawPages.length < 3) return;
  const topFreq = new Map();
  const botFreq = new Map();
  const norm = s => s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();

  for (const p of rawPages) {
    const seenTop = new Set(), seenBot = new Set();
    for (const l of p.lines) {
      const k = norm(l.text);
      if (!k || k.length > 90) continue;
      if (l.y > p.pageH * 0.90 && !seenTop.has(k)) {
        seenTop.add(k);
        topFreq.set(k, (topFreq.get(k) || 0) + 1);
      }
      if (l.y < p.pageH * 0.10 && !seenBot.has(k)) {
        seenBot.add(k);
        botFreq.set(k, (botFreq.get(k) || 0) + 1);
      }
    }
  }
  const threshold = Math.max(2, Math.ceil(rawPages.length * 0.45));
  for (const p of rawPages) {
    p.lines = p.lines.filter(l => {
      const k = norm(l.text);
      if (l.y > p.pageH * 0.90 && (topFreq.get(k) || 0) >= threshold) return false;
      if (l.y < p.pageH * 0.10 && (botFreq.get(k) || 0) >= threshold) return false;
      // 过滤常见广告/机构页脚行
      if ((l.y < p.pageH * 0.11 || l.y > p.pageH * 0.90) && /(公众号|微信|关注|淘宝|微博|http:\/\/|https:\/\/|www\.|QQ群|考研资料|扫码)/i.test(l.text)) {
        return false;
      }
      return true;
    });
  }
}

// =========================================================================
// 4. 基于几何特征将行流重组为准确段落
// =========================================================================
function computeColStats(lines) {
  const byCol = new Map();
  for (const l of lines) {
    const key = `${l.pageNum}:${l.col}`;
    if (!byCol.has(key)) byCol.set(key, []);
    byCol.get(key).push(l);
  }
  const stats = new Map();
  for (const [key, arr] of byCol.entries()) {
    const xs = arr.map(l => l.x).sort((a, b) => a - b);
    const rights = arr.map(l => l.right).sort((a, b) => a - b);
    const widths = arr.map(l => l.width).sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < arr.length; i++) {
      const dy = arr[i - 1].y - arr[i].y;
      if (dy > 4 && dy < 45) gaps.push(dy);
    }
    gaps.sort((a, b) => a - b);
    stats.set(key, {
      leftMargin: xs[Math.floor(xs.length * 0.12)] || 0,
      rightMargin: rights[Math.floor(rights.length * 0.85)] || 500,
      typicalWidth: widths[Math.floor(widths.length * 0.72)] || 350,
      lineSpacing: gaps.length ? gaps[Math.floor(gaps.length * 0.45)] : 15
    });
  }
  return stats;
}

function stitchLinesToParagraphs(lines, colStats) {
  if (!lines.length) return [];
  const paragraphs = [];
  let buf = '';
  let prev = null;

  const flush = () => {
    const clean = buf.replace(/[ \t]{2,}/g, ' ').trim();
    if (clean) paragraphs.push(clean);
    buf = '';
  };

  const appendText = (chunk) => {
    const c = chunk.trim();
    if (!c) return;
    if (!buf) { buf = c; return; }
    // 自动消除跨行连字符断词：如 "develop-" + "ment" -> "development"
    if (/[a-z]-$/.test(buf) && /^[a-z]/.test(c)) {
      buf = buf.slice(0, -1) + c;
    } else if (/[\u4e00-\u9fa5]$/.test(buf) && /^[\u4e00-\u9fa5]/.test(c)) {
      buf += c;
    } else {
      buf += ' ' + c;
    }
  };

  for (const line of lines) {
    const t = line.text.trim();
    if (!t) continue;

    if (!prev) {
      appendText(t);
      prev = line;
      continue;
    }

    const st = colStats.get(`${line.pageNum}:${line.col}`) || { leftMargin: 0, rightMargin: 500, typicalWidth: 350, lineSpacing: 15 };
    const prevSt = colStats.get(`${prev.pageNum}:${prev.col}`) || st;
    const sameFlow = line.pageNum === prev.pageNum && line.col === prev.col;
    const dy = sameFlow ? (prev.y - line.y) : 0;

    const prevEndsSentence = /[.!?。！？]["'”’)\]]*$/.test(prev.text.trim());
    const nextIndented = (line.x - st.leftMargin) > Math.max(10, line.fontSize * 1.15) && !line.isCentered;
    const bigVerticalGap = sameFlow && dy > prevSt.lineSpacing * 1.38;
    const prevShortLine = prev.width < prevSt.typicalWidth * 0.78 && (prevSt.rightMargin - prev.right) > prev.fontSize * 2.8;
    const nextStartsCap = /^[A-Z"“‘'(\[（\d①②③④⑤]/.test(t);
    const isListOrTag = /^(\([A-G1-9]\)|\[[A-G1-9]\]|[A-G]\.\s|\d{1,2}\.\s|Paragraph\s+\d)/i.test(t);

    let isNewPara = false;
    if (isListOrTag) {
      isNewPara = true;
    } else if (nextIndented) {
      isNewPara = true;
    } else if (bigVerticalGap) {
      isNewPara = true;
    } else if (prevEndsSentence && prevShortLine && nextStartsCap) {
      isNewPara = true;
    } else if (!sameFlow) {
      // 跨页/跨栏衔接：若上页末尾以句号结束，且新页首行大写开头或缩进，则分段；否则无缝续接！
      if (prevEndsSentence && (nextIndented || (prevShortLine && nextStartsCap))) {
        isNewPara = true;
      }
    }

    if (isNewPara) flush();
    appendText(t);
    prev = line;
  }
  flush();
  return paragraphs;
}

// =========================================================================
// 5. 智能识别拆分模式与文章切分（考研真题 / 外刊多篇 / 整份 / 按页）
// =========================================================================
function flattenAllLines(rawPages) {
  const all = [];
  for (const p of rawPages) {
    for (const l of p.lines) {
      all.push({ ...l, pageNum: p.pageNum, bodyFontSize: p.bodyFontSize, pageH: p.pageH, pageW: p.pageW });
    }
  }
  return all;
}

function detectPdfBestMode(allLines) {
  let textMarkers = 0;
  let hasKaoyanHeader = false;
  for (const l of allLines) {
    const t = l.text.trim();
    if (/^Text\s*[1-4]\b/i.test(t)) textMarkers++;
    if (/Reading\s+Comprehension|Use\s+of\s+English|全国硕士研究生|英语[（(][一二][)）]/i.test(t)) {
      hasKaoyanHeader = true;
    }
  }
  if (textMarkers >= 2 || (textMarkers >= 1 && hasKaoyanHeader)) return 'kaoyan';

  // 检查是否有明显的 Passage / Article / Unit / 多大标题
  let multiMarkers = 0;
  for (const l of allLines) {
    const t = l.text.trim();
    if (/^(Passage|Article|Unit|Lesson|Chapter|Essay)\s*\d+\b/i.test(t) || /^第\s*[一二三四五六七八九十\d]+\s*[篇讲章课]/.test(t)) {
      multiMarkers++;
    }
  }
  if (multiMarkers >= 2) return 'multi';
  return 'multi';
}

function detectExamMeta(text, current) {
  const next = { ...current };
  const yearM = text.match(/(20[0-3]\d)\s*(?:年|考研|全国硕士研究生)?/);
  if (yearM && /(考研|全国硕士研究生|英语|真题|模拟|试题)/.test(text)) {
    next.year = yearM[1];
  }
  if (/英语\s*[（(]?\s*一\s*[)）]?|English\s*\(?\s*I\s*\)?(?!I)/i.test(text)) {
    next.examType = '英语一';
    next.source = '英一真题';
  } else if (/英语\s*[（(]?\s*二\s*[)）]?|English\s*\(?\s*II\s*\)?/i.test(text)) {
    next.examType = '英语二';
    next.source = '英二真题';
  }
  return next;
}

function isKaoyanDirectionsLine(t) {
  return /^(Directions?\s*[:：]|Read the following|Choose the best word|In the following article|You should write|Write a|For each numbered blank)/i.test(t)
    || /根据.*短文|请从.*选项中|满分\s*\d+\s*分|每小题\s*[\d.]+\s*分|答案写在答题卡/.test(t);
}

function isKaoyanQuestionStart(lines, idx) {
  const t = lines[idx].text.trim();
  // 匹配 21. xxx / 21、xxx / 21) xxx / Q21. xxx（考研阅读题号通常是 21~45，也兼容 1~20 模拟题）
  const m = t.match(/^(?:Q\s*)?(\d{1,2})\s*[.、)）]\s+(.+)$/);
  if (!m) return false;
  const num = parseInt(m[1], 10);
  if (num < 1 || num > 60) return false;
  // 若题干同一行里直接包含 [A] / (A) 选项
  if (/\[A\]|\(A\)/.test(t)) return true;
  // 向下看 7 行内是否出现选项 [A] / A. / A) 或另一道紧邻题号
  for (let k = idx + 1; k < Math.min(lines.length, idx + 8); k++) {
    const nt = lines[k].text.trim();
    if (/^(\[A\]|\[B\]|\(A\)|A\s*[.．)）]\s+\S)/.test(nt)) return true;
    const nm = nt.match(/^(?:Q\s*)?(\d{1,2})\s*[.、)）]\s+/);
    if (nm && parseInt(nm[1], 10) === num + 1) return true;
  }
  return false;
}

function splitKaoyanArticles(allLines, colStats, stripQuestions) {
  const rawBlocks = [];
  let examMeta = { year: '', examType: '', source: '真题' };

  // 先从文件名里尝试提取年份和英一/英二
  examMeta = detectExamMeta(pdfImportState.fileName || '', examMeta);

  let cur = null;
  let inWriting = false;

  const pushCurrent = () => {
    if (!cur || !cur.lines.length) { cur = null; return; }
    rawBlocks.push(cur);
    cur = null;
  };

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    const t = line.text.trim();
    if (!t) continue;

    // 实时更新年份和英一/英二上下文
    if (t.length < 70 && /(20[0-3]\d|英语[（(]?[一二][)）]?|全国硕士研究生)/.test(t)) {
      examMeta = detectExamMeta(t, examMeta);
    }

    // 遇到作文 Section III / Writing，停止收集阅读（但允许后续年份的新试卷重新开始）
    if (/^Section\s*(III|3)\b.*Writing|^Part\s*[AB]\s*\(\s*(10|15|20)\s*points?\s*\)/i.test(t) || /^Section\s*(III|3)\s*$/i.test(t)) {
      pushCurrent();
      inWriting = true;
      continue;
    }

    // 遇到答案解析部分（如 "参考答案" / "答案速查"），结束当前试卷收集
    if (/^(参考答案|答案解析|答案速查|真题解析|Section\s*I\s*答案)/i.test(t) && t.length < 30) {
      pushCurrent();
      inWriting = true;
      continue;
    }

    // 检测 Section I Use of English（完形填空）
    if (/^Section\s*(I|1)\b.*Use\s+of\s+English/i.test(t) || /^Use\s+of\s+English$/i.test(t)) {
      pushCurrent();
      inWriting = false;
      const prefix = [examMeta.year, examMeta.examType].filter(Boolean).join(' ');
      cur = {
        kind: 'cloze',
        tag: '完形填空',
        defaultChecked: false,
        title: prefix ? `${prefix} 完形填空` : '完形填空 (Use of English)',
        source: examMeta.source || '完形填空',
        lines: []
      };
      continue;
    }

    // 检测 Reading Comprehension Text 1 ~ Text 4
    const textM = t.match(/^Text\s*([1-6])\b(?:\s*[:：\-—]\s*(.*))?$/i);
    if (textM) {
      pushCurrent();
      inWriting = false;
      const n = textM[1];
      const prefix = [examMeta.year, examMeta.examType].filter(Boolean).join(' ');
      cur = {
        kind: 'reading',
        tag: `Text ${n}`,
        defaultChecked: true,
        title: prefix ? `${prefix} Text ${n}` : `Reading Text ${n}`,
        source: examMeta.source || '真题',
        lines: []
      };
      if (textM[2] && textM[2].trim().length > 12) {
        cur.lines.push({ ...line, text: textM[2].trim() });
      }
      continue;
    }

    // 检测 Part B（新题型）
    if (/^Part\s*B\b/i.test(t) && t.length < 40 && !inWriting) {
      pushCurrent();
      const prefix = [examMeta.year, examMeta.examType].filter(Boolean).join(' ');
      cur = {
        kind: 'partb',
        tag: 'Part B 新题型',
        defaultChecked: false,
        title: prefix ? `${prefix} Part B 新题型` : 'Reading Part B 新题型',
        source: '新题型',
        lines: []
      };
      continue;
    }

    // 检测 Part C / Translation（翻译）
    if ((/^Part\s*C\b/i.test(t) || /^Section\s*(III|3)\b.*Translation/i.test(t)) && t.length < 45) {
      pushCurrent();
      inWriting = false;
      const prefix = [examMeta.year, examMeta.examType].filter(Boolean).join(' ');
      cur = {
        kind: 'translation',
        tag: '翻译',
        defaultChecked: false,
        title: prefix ? `${prefix} 翻译` : 'Translation 翻译',
        source: '翻译',
        lines: []
      };
      continue;
    }

    if (inWriting) continue;
    if (cur) {
      cur.lines.push(line);
    }
  }
  pushCurrent();

  // 对每个区块清洗 Directions 并分离原文与选择题题干
  const articles = [];
  for (const blk of rawBlocks) {
    // 去掉开头的 Directions 说明行
    let startIdx = 0;
    while (startIdx < blk.lines.length && startIdx < 12) {
      const lt = blk.lines[startIdx].text.trim();
      if (isKaoyanDirectionsLine(lt) || /^(Section\s*II|Part\s*A|Reading\s+Comprehension|\(\d+\s*points?\))/i.test(lt)) {
        startIdx++;
        // 若 Directions 跨多行，继续跳过直到句子结束且下一行不再像说明
        while (startIdx < blk.lines.length && startIdx < 14 && /ANSWER SHEET|points?\)|four choices|marked \[A\]|following text/i.test(blk.lines[startIdx].text)) {
          startIdx++;
        }
      } else {
        break;
      }
    }

    const effective = blk.lines.slice(startIdx);
    if (!effective.length) continue;

    let splitQIdx = -1;
    if (stripQuestions && (blk.kind === 'reading' || blk.kind === 'cloze')) {
      for (let i = 0; i < effective.length; i++) {
        if (isKaoyanQuestionStart(effective, i)) {
          splitQIdx = i;
          break;
        }
      }
    }

    const bodyLines = splitQIdx >= 0 ? effective.slice(0, splitQIdx) : effective;
    const questionLines = splitQIdx >= 0 ? effective.slice(splitQIdx) : [];

    // 过滤正文末尾可能混入的 Section 标题
    const cleanBodyLines = bodyLines.filter(l => !/^(Section\s*(I|II|III)|Part\s*[ABC]\b)/i.test(l.text.trim()));
    const paragraphs = stitchLinesToParagraphs(cleanBodyLines, colStats);
    const wordCount = paragraphs.join(' ').trim() ? paragraphs.join(' ').trim().split(/\s+/).length : 0;
    if (wordCount < 25) continue;

    const pagesSet = [...new Set(cleanBodyLines.map(l => l.pageNum))].sort((a, b) => a - b);
    const pagesLabel = pagesSet.length > 1 ? `P.${pagesSet[0]}-${pagesSet[pagesSet.length - 1]}` : `P.${pagesSet[0] || 1}`;

    // 把题干行按题号整理成干净的 Markdown 文本
    const questionsText = formatExtractedQuestions(questionLines);

    articles.push({
      id: genId('pdfart'),
      checked: blk.defaultChecked,
      title: blk.title,
      source: blk.source,
      topic: '',
      tag: blk.tag,
      pages: pagesLabel,
      paragraphs,
      questionsText
    });
  }

  // 如果存在重名标题（比如多套没标年份的模拟卷），自动加序号
  const titleSeen = new Map();
  articles.forEach(a => {
    const c = (titleSeen.get(a.title) || 0) + 1;
    titleSeen.set(a.title, c);
    if (c > 1) a.title = `${a.title} (${c})`;
  });

  return articles;
}

function formatExtractedQuestions(qLines) {
  if (!qLines || !qLines.length) return '';
  const out = [];
  for (const l of qLines) {
    const t = l.text.trim();
    if (!t) continue;
    if (/^(?:Q\s*)?\d{1,2}\s*[.、)）]\s+/.test(t)) {
      if (out.length) out.push('');
      out.push(`**${t}**`);
    } else if (/^(\[[A-D]\]|\([A-D]\)|[A-D]\s*[.．)）]\s+)/.test(t)) {
      out.push(`- ${t}`);
    } else if (out.length) {
      out[out.length - 1] += ' ' + t;
    } else {
      out.push(t);
    }
  }
  return out.join('\n').trim();
}

// 模式 2：外刊/讲义多篇模式（按 Passage/Unit/大字号居中或独立大标题拆篇）
function splitMultiArticles(allLines, colStats) {
  const blocks = [];
  let cur = null;

  const isHeadingLine = (line, prevLine) => {
    const t = line.text.trim();
    if (!t || t.length > 120) return false;
    // 明确的文章分隔标记
    if (/^(Passage|Text|Article|Unit|Lesson|Chapter|Reading|Essay)\s*\d+\b/i.test(t)) return true;
    if (/^第\s*[一二三四五六七八九十\d]+\s*[篇讲章课]/.test(t)) return true;
    // 显著大字号标题（>= 1.28 倍正文字号，且不以逗号/分号结尾，不是纯数字）
    const isBigFont = line.fontSize >= (line.bodyFontSize || 11) * 1.28;
    const notJustNum = !/^[\d.\-—\s]+$/.test(t);
    const notMidSentence = !/[,;:]$/.test(t);
    if (isBigFont && notJustNum && notMidSentence && t.length >= 4) {
      // 如果上一行也是同样大字号且离得很近，属于同一标题的折行，不另起一篇
      if (prevLine && prevLine.pageNum === line.pageNum && Math.abs(prevLine.fontSize - line.fontSize) < 1.2 && (prevLine.y - line.y) < line.fontSize * 1.8) {
        return false;
      }
      return true;
    }
    return false;
  };

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    const prev = i > 0 ? allLines[i - 1] : null;
    if (isHeadingLine(line, prev)) {
      // 合并可能折行的多行标题
      let titleText = line.text.trim();
      let j = i + 1;
      while (j < allLines.length && j <= i + 2) {
        const nl = allLines[j];
        if (nl.pageNum === line.pageNum && Math.abs(nl.fontSize - line.fontSize) < 1.2 && (allLines[j - 1].y - nl.y) < line.fontSize * 1.8 && nl.text.trim().length < 90) {
          titleText += ' ' + nl.text.trim();
          j++;
        } else break;
      }
      if (cur && cur.lines.length) blocks.push(cur);
      cur = { title: titleText.slice(0, 90), lines: [] };
      i = j - 1;
      continue;
    }
    if (!cur) {
      const baseName = (pdfImportState.fileName || '导入文章').replace(/\.pdf$/i, '');
      cur = { title: baseName, lines: [] };
    }
    cur.lines.push(line);
  }
  if (cur && cur.lines.length) blocks.push(cur);

  // 如果拆出的块全都很短或没有拆分出来，回退为单篇
  const articles = [];
  for (const blk of blocks) {
    const paragraphs = stitchLinesToParagraphs(blk.lines, colStats);
    const wc = paragraphs.join(' ').trim() ? paragraphs.join(' ').trim().split(/\s+/).length : 0;
    if (wc < 20) continue;
    const pages = [...new Set(blk.lines.map(l => l.pageNum))].sort((a, b) => a - b);
    articles.push({
      id: genId('pdfart'),
      checked: true,
      title: blk.title || `文章 ${articles.length + 1}`,
      source: '外刊精读',
      topic: '',
      tag: `第 ${articles.length + 1} 篇`,
      pages: pages.length > 1 ? `P.${pages[0]}-${pages[pages.length - 1]}` : `P.${pages[0] || 1}`,
      paragraphs,
      questionsText: ''
    });
  }
  return articles;
}

// 模式 3：整份合并为一篇
function splitSingleArticle(allLines, colStats) {
  const paragraphs = stitchLinesToParagraphs(allLines, colStats);
  if (!paragraphs.length) return [];
  const pages = [...new Set(allLines.map(l => l.pageNum))].sort((a, b) => a - b);
  const baseName = (pdfImportState.fileName || 'PDF 导入文章').replace(/\.pdf$/i, '');
  return [{
    id: genId('pdfart'),
    checked: true,
    title: baseName,
    source: '外刊精读',
    topic: '',
    tag: '整份合并',
    pages: pages.length > 1 ? `P.${pages[0]}-${pages[pages.length - 1]}` : `P.${pages[0] || 1}`,
    paragraphs,
    questionsText: ''
  }];
}

// 模式 4：每页拆一篇
function splitPerPageArticles(rawPages, colStats) {
  const baseName = (pdfImportState.fileName || 'PDF 文章').replace(/\.pdf$/i, '');
  const articles = [];
  for (const p of rawPages) {
    const pageLines = p.lines.map(l => ({ ...l, pageNum: p.pageNum }));
    const paragraphs = stitchLinesToParagraphs(pageLines, colStats);
    const wc = paragraphs.join(' ').trim() ? paragraphs.join(' ').trim().split(/\s+/).length : 0;
    if (wc < 10) continue;
    articles.push({
      id: genId('pdfart'),
      checked: true,
      title: `${baseName} · 第 ${p.pageNum} 页`,
      source: '外刊精读',
      topic: '',
      tag: `P.${p.pageNum}`,
      pages: `P.${p.pageNum}`,
      paragraphs,
      questionsText: ''
    });
  }
  return articles;
}

// 执行切分逻辑（不重新读 PDF 文件，秒级重新切分！）
function runPdfArticleSplit() {
  const rawPages = pdfImportState.rawPages;
  if (!rawPages || !rawPages.length) {
    pdfImportState.articles = [];
    renderPdfImportModal();
    return;
  }

  const allLines = flattenAllLines(rawPages);
  const colStats = computeColStats(allLines);
  const detected = detectPdfBestMode(allLines);
  pdfImportState.detectedMode = detected;
  const effectiveMode = pdfImportState.mode === 'auto' ? detected : pdfImportState.mode;

  let articles = [];
  if (effectiveMode === 'kaoyan') {
    articles = splitKaoyanArticles(allLines, colStats, pdfImportState.stripQuestions);
    if (!articles.length) {
      // 考研模式未命中 Text 1~4 时友好降级到多篇/整份
      articles = splitMultiArticles(allLines, colStats);
      if (!articles.length) articles = splitSingleArticle(allLines, colStats);
    }
  } else if (effectiveMode === 'multi') {
    articles = splitMultiArticles(allLines, colStats);
    if (!articles.length) articles = splitSingleArticle(allLines, colStats);
  } else if (effectiveMode === 'perpage') {
    articles = splitPerPageArticles(rawPages, colStats);
  } else {
    articles = splitSingleArticle(allLines, colStats);
  }

  pdfImportState.articles = articles;
  pdfImportState.selectedIdx = 0;
  renderPdfImportModal();
}

// =========================================================================
// 6. PDF 导入工作台交互逻辑 (#pdfImportModal)
// =========================================================================
function openPdfImportModal() {
  const modal = document.getElementById('pdfImportModal');
  if (!modal) return;
  modal.classList.add('open');
  renderPdfImportModal();
}

function closePdfImportModal() {
  const modal = document.getElementById('pdfImportModal');
  if (modal) modal.classList.remove('open');
}

function onPdfFileInputChange(event) {
  const file = event.target && event.target.files && event.target.files[0];
  if (file) handlePdfFileSelected(file);
  if (event.target) event.target.value = '';
}

function onPdfDropZoneDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const dz = document.getElementById('pdf-drop-zone');
  if (dz) dz.classList.remove('border-blue-500', 'bg-blue-50/70');
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    showToast('请拖入 .pdf 格式文件', 'warning');
    return;
  }
  handlePdfFileSelected(file);
}

async function handlePdfFileSelected(file) {
  pdfImportState.fileName = file.name;
  pdfImportState.error = '';
  pdfImportState.warning = '';
  pdfImportState.articles = [];
  pdfImportState.rawPages = [];
  pdfImportState.pageRange = '';
  pdfImportState.parsing = true;
  renderPdfImportModal('正在读取 PDF 文件…');

  try {
    pdfImportState.arrayBuffer = await file.arrayBuffer();
    await parseLoadedPdfBuffer();
  } catch (err) {
    pdfImportState.parsing = false;
    pdfImportState.error = err && err.message ? err.message : 'PDF 文件读取失败';
    renderPdfImportModal();
  }
}

async function parseLoadedPdfBuffer() {
  if (!pdfImportState.arrayBuffer) return;
  pdfImportState.parsing = true;
  pdfImportState.error = '';
  pdfImportState.warning = '';
  renderPdfImportModal('正在加载 PDF 解析引擎…');

  try {
    const pdfjsLib = await ensurePdfJsLoaded();
    renderPdfImportModal('正在打开 PDF 文档…');

    const opts = { data: pdfImportState.arrayBuffer.slice(0) };
    if (pdfJsActiveCdn && pdfJsActiveCdn.cMapUrl) {
      opts.cMapUrl = pdfJsActiveCdn.cMapUrl;
      opts.cMapPacked = true;
    }
    if (pdfJsActiveCdn && pdfJsActiveCdn.standardFontDataUrl) {
      opts.standardFontDataUrl = pdfJsActiveCdn.standardFontDataUrl;
    }

    const pdfDoc = await pdfjsLib.getDocument(opts).promise;
    pdfImportState.numPages = pdfDoc.numPages;

    const targetPages = parsePdfPageRange(pdfImportState.pageRange, pdfDoc.numPages);
    const rawPages = [];
    let totalChars = 0;

    for (let idx = 0; idx < targetPages.length; idx++) {
      const pNum = targetPages[idx];
      renderPdfImportModal(`正在解析第 ${pNum} 页（进度 ${idx + 1} / ${targetPages.length}）…`);
      const page = await pdfDoc.getPage(pNum);
      const viewport = page.getViewport({ scale: 1.0 });
      const textContent = await page.getTextContent();
      const extracted = extractPageLines(textContent, viewport, pdfImportState.cleanHeaders);
      extracted.lines.forEach(l => { totalChars += l.text.length; });
      rawPages.push({ pageNum: pNum, ...extracted });
    }

    if (pdfImportState.cleanHeaders) {
      stripRepeatedRunningLines(rawPages);
    }

    pdfImportState.rawPages = rawPages;
    pdfImportState.parsing = false;

    if (totalChars / Math.max(1, targetPages.length) < 25) {
      pdfImportState.warning = '该 PDF 提取到的文字极少，可能是纯图片扫描版（无可选中文字层）。建议先用 WPS / 夸克 / 微信 OCR 转为可复制文字 PDF，或复制文本后使用「按段落粘贴」。';
    }

    runPdfArticleSplit();
  } catch (err) {
    pdfImportState.parsing = false;
    pdfImportState.error = err && err.message ? err.message : 'PDF 解析失败';
    renderPdfImportModal();
  }
}

function setPdfImportOption(key, value) {
  pdfImportState[key] = value;
  if (key === 'cleanHeaders' || key === 'pageRange') {
    parseLoadedPdfBuffer();
  } else {
    runPdfArticleSplit();
  }
}

function onPdfReparseRange() {
  const inp = document.getElementById('pdf-page-range');
  pdfImportState.pageRange = inp ? inp.value.trim() : '';
  parseLoadedPdfBuffer();
}

function selectPdfPreviewArticle(idx) {
  pdfImportState.selectedIdx = idx;
  renderPdfImportModal();
}

function togglePdfArticleCheck(idx, checked) {
  const a = pdfImportState.articles[idx];
  if (!a) return;
  a.checked = checked;
  renderPdfImportModal();
}

function toggleAllPdfArticles(checked) {
  pdfImportState.articles.forEach(a => { a.checked = checked; });
  renderPdfImportModal();
}

function updatePdfArticleField(idx, field, value) {
  const a = pdfImportState.articles[idx];
  if (!a) return;
  a[field] = value;
  if (field === 'title') {
    const titleEl = document.getElementById(`pdf-art-title-${idx}`);
    if (titleEl) titleEl.textContent = value || '未命名文章';
  }
}

function updatePdfArticlePara(artIdx, paraIdx, value) {
  const a = pdfImportState.articles[artIdx];
  if (!a) return;
  a.paragraphs[paraIdx] = value;
}

function mergePdfParaWithPrev(artIdx, paraIdx) {
  const a = pdfImportState.articles[artIdx];
  if (!a || paraIdx <= 0) return;
  a.paragraphs[paraIdx - 1] = (a.paragraphs[paraIdx - 1].trim() + ' ' + a.paragraphs[paraIdx].trim()).trim();
  a.paragraphs.splice(paraIdx, 1);
  renderPdfImportModal();
}

function splitPdfParaAtCursor(artIdx, paraIdx) {
  const a = pdfImportState.articles[artIdx];
  const ta = document.getElementById(`pdf-para-ta-${artIdx}-${paraIdx}`);
  if (!a || !ta) return;
  const pos = ta.selectionStart;
  const val = ta.value;
  if (!pos || pos <= 0 || pos >= val.length) {
    showToast('请先把光标放到段落中要拆分的位置，再点击「✂️ 光标处拆分」', 'info');
    return;
  }
  const p1 = val.slice(0, pos).trim();
  const p2 = val.slice(pos).trim();
  if (!p1 || !p2) return;
  a.paragraphs.splice(paraIdx, 1, p1, p2);
  renderPdfImportModal();
}

function deletePdfPara(artIdx, paraIdx) {
  const a = pdfImportState.articles[artIdx];
  if (!a) return;
  a.paragraphs.splice(paraIdx, 1);
  renderPdfImportModal();
}

function mergePdfArticleWithPrev(idx) {
  if (idx <= 0 || idx >= pdfImportState.articles.length) return;
  const prev = pdfImportState.articles[idx - 1];
  const curr = pdfImportState.articles[idx];
  prev.paragraphs.push(...curr.paragraphs);
  if (curr.questionsText) {
    prev.questionsText = prev.questionsText ? (prev.questionsText + '\n\n' + curr.questionsText) : curr.questionsText;
  }
  pdfImportState.articles.splice(idx, 1);
  pdfImportState.selectedIdx = Math.max(0, idx - 1);
  renderPdfImportModal();
  showToast('已合并到上一篇文章', 'info');
}

function deletePdfArticle(idx) {
  pdfImportState.articles.splice(idx, 1);
  pdfImportState.selectedIdx = Math.min(pdfImportState.selectedIdx, Math.max(0, pdfImportState.articles.length - 1));
  renderPdfImportModal();
}

async function importCheckedPdfArticles() {
  const chosen = pdfImportState.articles.filter(a => a.checked);
  if (!chosen.length) {
    showToast('请至少勾选一篇文章再导入', 'warning');
    return;
  }
  let firstId = '';
  let count = 0;
  for (const a of chosen) {
    const cleanParas = a.paragraphs.map(p => String(p || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!cleanParas.length) continue;
    const text = cleanParas.join('\n\n');
    let summary = '';
    if (pdfImportState.attachQuestionsToNote && a.questionsText) {
      summary = `## 📋 原文题目\n\n${a.questionsText}\n\n## 🎯 文章主旨与复盘\n\n- `;
    }
    const r = migrateReading({
      title: (a.title || 'PDF 导入文章').trim(),
      source: (a.source || '').trim(),
      topic: (a.topic || '').trim(),
      dateStr: todayISO(),
      text,
      summary
    });
    readingStore.push(r);
    if (!firstId) firstId = r.id;
    count++;
  }
  if (!count) {
    showToast('所选文章内容为空，未导入', 'warning');
    return;
  }
  readingCurrentId = firstId;
  saveReadingPrefs();
  closePdfImportModal();
  await persistReadingStore(true);
  renderReadings();
  updateTabCounts();
  showToast(`成功从 PDF 导入 ${count} 篇文章到独立阅读库！`, 'success');
}

// =========================================================================
// 7. 渲染 PDF 拆文章工作台 UI
// =========================================================================
function renderPdfImportModal(loadingMsg = '') {
  const body = document.getElementById('pdf-import-body');
  const footerInfo = document.getElementById('pdf-import-footer-info');
  const importBtn = document.getElementById('pdf-import-submit-btn');
  if (!body) return;

  const st = pdfImportState;
  const checkedCount = st.articles.filter(a => a.checked).length;

  if (footerInfo) {
    footerInfo.textContent = st.articles.length
      ? `共识别出 ${st.articles.length} 篇文章 · 已勾选 ${checkedCount} 篇`
      : '完全在浏览器本地解析，不上传任何文件';
  }
  if (importBtn) {
    importBtn.disabled = st.parsing || checkedCount === 0;
    importBtn.textContent = checkedCount > 0 ? `📥 导入已勾选 (${checkedCount} 篇)` : '📥 批量导入阅读库';
  }

  // 初始未选择文件：展示大号拖放上传区
  if (!st.fileName && !st.parsing) {
    body.innerHTML = `
      <div id="pdf-drop-zone"
        ondragover="event.preventDefault(); this.classList.add('border-blue-500','bg-blue-50/70')"
        ondragleave="this.classList.remove('border-blue-500','bg-blue-50/70')"
        ondrop="onPdfDropZoneDrop(event)"
        onclick="document.getElementById('pdfFileInput').click()"
        class="cursor-pointer border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/40 rounded-2xl p-10 text-center transition-all">
        <div class="text-5xl mb-3">📄</div>
        <div class="text-base font-bold text-slate-800">点击选择 PDF 或将 PDF 拖到这里</div>
        <p class="text-xs text-slate-500 mt-2 max-w-lg mx-auto leading-relaxed">
          支持 <b>考研英语一 / 英语二真题 PDF</b>（单年或多年合集，自动拆出 Text 1~4 并剔除选择题）、<b>外刊合集 / 讲义 PDF</b>。<br>
          基于 PDF 真实坐标自动识别单/双栏、首行缩进分段、去页眉页脚与斜向水印，全本地解析。
        </p>
        <div class="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white shadow-sm">
          📂 选择本地 PDF 文件
        </div>
      </div>`;
    return;
  }

  // 解析进度中
  if (st.parsing) {
    body.innerHTML = `
      <div class="py-16 text-center space-y-3">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200">
          <span class="rd-spinner"></span>
        </div>
        <div class="text-sm font-bold text-slate-800">${escapeHtml(loadingMsg || '正在解析 PDF…')}</div>
        <div class="text-xs text-slate-500">${escapeHtml(st.fileName)}</div>
      </div>`;
    return;
  }

  const cur = st.articles[st.selectedIdx] || null;

  body.innerHTML = `
    <!-- 顶部文件信息与拆分控制条 -->
    <div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-2.5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-lg">📄</span>
          <span class="text-sm font-bold text-slate-800 truncate max-w-[260px]" title="${escapeHtml(st.fileName)}">${escapeHtml(st.fileName)}</span>
          <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">共 ${st.numPages} 页</span>
          ${st.rawPages.some(p => p.isTwoCol) ? '<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">已识别双栏排版</span>' : ''}
        </div>
        <button onclick="document.getElementById('pdfFileInput').click()" class="btn-tactile px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100">📂 更换 PDF</button>
      </div>
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <label class="inline-flex items-center gap-1.5 text-slate-600 font-semibold">
          <span>拆分模式</span>
          <select onchange="setPdfImportOption('mode', this.value)" class="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 outline-none focus:border-blue-500">
            <option value="auto" ${st.mode === 'auto' ? 'selected' : ''}>✨ 自动识别 (${st.detectedMode === 'kaoyan' ? '考研真题' : '多篇外刊'})</option>
            <option value="kaoyan" ${st.mode === 'kaoyan' ? 'selected' : ''}>🎓 考研真题（拆 Text 1~4）</option>
            <option value="multi" ${st.mode === 'multi' ? 'selected' : ''}>📰 外刊/讲义（按标题拆篇）</option>
            <option value="single" ${st.mode === 'single' ? 'selected' : ''}>📄 整份合并为 1 篇</option>
            <option value="perpage" ${st.mode === 'perpage' ? 'selected' : ''}>📑 按页拆篇（每页 1 篇）</option>
          </select>
        </label>
        <div class="inline-flex items-center gap-1">
          <span class="text-slate-600 font-semibold">页码</span>
          <input type="text" id="pdf-page-range" value="${escapeHtml(st.pageRange)}" placeholder="全部 (如 1-12)" onkeydown="if(event.key==='Enter') onPdfReparseRange()"
            class="w-28 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 outline-none focus:border-blue-500" />
          <button onclick="onPdfReparseRange()" class="btn-tactile px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 font-semibold hover:bg-blue-100">重解析</button>
        </div>
        <label class="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white border border-slate-200 cursor-pointer select-none text-slate-700">
          <input type="checkbox" ${st.stripQuestions ? 'checked' : ''} onchange="setPdfImportOption('stripQuestions', this.checked)" class="accent-blue-600" />
          <span>剔除选择题题干</span>
        </label>
        <label class="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white border border-slate-200 cursor-pointer select-none text-slate-700">
          <input type="checkbox" ${st.attachQuestionsToNote ? 'checked' : ''} onchange="setPdfImportOption('attachQuestionsToNote', this.checked)" class="accent-blue-600" />
          <span>题目附到总结笔记</span>
        </label>
        <label class="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white border border-slate-200 cursor-pointer select-none text-slate-700">
          <input type="checkbox" ${st.cleanHeaders ? 'checked' : ''} onchange="setPdfImportOption('cleanHeaders', this.checked)" class="accent-blue-600" />
          <span>去页眉页脚/水印</span>
        </label>
      </div>
    </div>

    ${st.error ? `<div class="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 leading-relaxed">❌ ${escapeHtml(st.error)}</div>` : ''}
    ${st.warning ? `<div class="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 leading-relaxed">⚠️ ${escapeHtml(st.warning)}</div>` : ''}

    ${!st.articles.length ? `
      <div class="py-10 text-center text-xs text-slate-400">
        当前模式下未识别到有效文章，可尝试切换上方「拆分模式」为「整份合并」或调整页码范围。
      </div>` : `
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3.5 min-h-[380px]">
        <!-- 左：拆出的文章清单 -->
        <div class="lg:col-span-4 border border-slate-200 rounded-2xl bg-slate-50/50 p-2.5 flex flex-col">
          <div class="flex items-center justify-between px-1 pb-2 mb-2 border-b border-slate-200/80 text-xs">
            <span class="font-bold text-slate-700">拆出文章 (${st.articles.length})</span>
            <div class="flex items-center gap-2">
              <button onclick="toggleAllPdfArticles(true)" class="text-blue-600 hover:underline font-semibold">全选</button>
              <button onclick="toggleAllPdfArticles(false)" class="text-slate-500 hover:underline">全不选</button>
            </div>
          </div>
          <div class="space-y-1.5 overflow-y-auto max-h-[420px] pr-0.5">
            ${st.articles.map((a, idx) => {
              const wc = a.paragraphs.join(' ').trim() ? a.paragraphs.join(' ').trim().split(/\s+/).length : 0;
              const active = idx === st.selectedIdx;
              return `
                <div onclick="selectPdfPreviewArticle(${idx})" class="p-2.5 rounded-xl border cursor-pointer transition-all ${active ? 'bg-blue-50 border-blue-300 shadow-xs' : 'bg-white border-slate-200/80 hover:border-blue-200'}">
                  <div class="flex items-start gap-2">
                    <input type="checkbox" ${a.checked ? 'checked' : ''} onclick="event.stopPropagation()" onchange="togglePdfArticleCheck(${idx}, this.checked)" class="mt-0.5 accent-blue-600 cursor-pointer" />
                    <div class="min-w-0 flex-1">
                      <div id="pdf-art-title-${idx}" class="text-xs font-bold ${active ? 'text-blue-800' : 'text-slate-800'} line-clamp-2 break-words">${escapeHtml(a.title)}</div>
                      <div class="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
                        <span class="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold">${escapeHtml(a.tag)}</span>
                        <span>${escapeHtml(a.pages)}</span>
                        <span>· ${a.paragraphs.length} 段 · ${wc} 词</span>
                        ${a.questionsText ? '<span class="text-emerald-600 font-semibold">· 含题目</span>' : ''}
                      </div>
                    </div>
                  </div>
                  <div class="mt-1.5 pt-1.5 border-t border-slate-100 flex items-center justify-end gap-1.5 text-[10px]">
                    ${idx > 0 ? `<button onclick="event.stopPropagation(); mergePdfArticleWithPrev(${idx})" class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200" title="合并到上一篇">⤴ 并入上篇</button>` : ''}
                    <button onclick="event.stopPropagation(); deletePdfArticle(${idx})" class="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 hover:bg-rose-100">删除</button>
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>

        <!-- 右：当前选中文章的分段预览与校对 -->
        <div class="lg:col-span-8 border border-slate-200 rounded-2xl bg-white p-3.5 flex flex-col">
          ${cur ? `
            <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 pb-3 mb-3 border-b border-slate-100">
              <div class="sm:col-span-6">
                <label class="block text-[10px] font-semibold text-slate-400 mb-1">文章标题</label>
                <input type="text" value="${escapeHtml(cur.title)}" oninput="updatePdfArticleField(${st.selectedIdx}, 'title', this.value)"
                  class="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 focus:border-blue-500 outline-none" />
              </div>
              <div class="sm:col-span-3">
                <label class="block text-[10px] font-semibold text-slate-400 mb-1">来源</label>
                <input type="text" value="${escapeHtml(cur.source)}" list="rd-source-presets" oninput="updatePdfArticleField(${st.selectedIdx}, 'source', this.value)"
                  class="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-700 focus:border-blue-500 outline-none" />
              </div>
              <div class="sm:col-span-3">
                <label class="block text-[10px] font-semibold text-slate-400 mb-1">题材标签</label>
                <input type="text" value="${escapeHtml(cur.topic || '')}" list="rd-topic-presets" placeholder="科技/经济…" oninput="updatePdfArticleField(${st.selectedIdx}, 'topic', this.value)"
                  class="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-700 focus:border-blue-500 outline-none" />
              </div>
            </div>
            <div class="text-[11px] text-slate-400 mb-2 flex items-center justify-between">
              <span>以下为自动还原的段落（可直接修改、合并上段，或把光标放段中点「✂️ 拆分」）</span>
              <span class="font-semibold text-slate-500">共 ${cur.paragraphs.length} 段</span>
            </div>
            <div class="space-y-2.5 overflow-y-auto max-h-[360px] pr-1">
              ${cur.paragraphs.map((p, pIdx) => {
                const pwc = p.trim() ? p.trim().split(/\s+/).length : 0;
                return `
                  <div class="p-2.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
                    <div class="flex items-center justify-between gap-2 mb-1.5 text-[11px]">
                      <div class="flex items-center gap-1.5">
                        <span class="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">P${pIdx + 1}</span>
                        <span class="text-slate-400">${pwc} 词</span>
                      </div>
                      <div class="flex items-center gap-1">
                        ${pIdx > 0 ? `<button type="button" onclick="mergePdfParaWithPrev(${st.selectedIdx}, ${pIdx})" class="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100" title="与上一段合并">⤴ 合并上段</button>` : ''}
                        <button type="button" onclick="splitPdfParaAtCursor(${st.selectedIdx}, ${pIdx})" class="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:bg-slate-100" title="在文本框光标处拆成两段">✂️ 光标拆分</button>
                        <button type="button" onclick="deletePdfPara(${st.selectedIdx}, ${pIdx})" class="px-1.5 py-0.5 rounded bg-white border border-rose-200 text-rose-500 hover:bg-rose-50" title="删除此段">✕</button>
                      </div>
                    </div>
                    <textarea id="pdf-para-ta-${st.selectedIdx}-${pIdx}" rows="${Math.min(7, Math.max(2, Math.ceil(p.length / 88)))}"
                      oninput="updatePdfArticlePara(${st.selectedIdx}, ${pIdx}, this.value)"
                      class="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[13px] font-serif leading-relaxed text-slate-800 focus:border-blue-500 outline-none resize-y">${escapeHtml(p)}</textarea>
                  </div>`;
              }).join('')}
              ${cur.questionsText ? `
                <details class="p-2.5 rounded-xl bg-emerald-50/50 border border-emerald-200/80 text-xs">
                  <summary class="cursor-pointer font-semibold text-emerald-800">📋 已自动剥离的随附题目预览（勾选上方「题目附到总结笔记」可一并带入）</summary>
                  <pre class="mt-2 whitespace-pre-wrap font-sans text-[11px] text-slate-600 leading-relaxed">${escapeHtml(cur.questionsText)}</pre>
                </details>` : ''}
            </div>` : '<div class="text-center text-xs text-slate-400 py-16">请点击左侧文章预览</div>'}
        </div>
      </div>`}
  `;
}
