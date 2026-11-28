// 英语阅读 · 外接翻译（B站 Index-Translate / 免代理免费翻译 / 自定义 OpenAI 兼容 API）、英文词典音标与朗读
// 普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

const LS_READING_TRANS_KEY = 'kaoyan_reading_translate_v1';
const BILIBILI_DIRECT_BASE = 'https://index-translate.bilibili.com/v1';
const BILIBILI_DEFAULT_MODEL = 'Index-Translate-35B-A3B';

const DEFAULT_READING_TRANS_CONFIG = {
  provider: 'bilibili_auto', // bilibili_auto | bilibili_proxy | bilibili_direct | mymemory | openai_compat
  proxyBaseUrl: 'http://127.0.0.1:8080/v1',
  bilibiliModel: BILIBILI_DEFAULT_MODEL,
  customBaseUrl: 'https://api.deepseek.com/v1',
  customApiKey: '',
  customModel: 'deepseek-chat',
  style: 'kaoyan' // kaoyan | literal | natural
};

const READING_TRANS_PROVIDER_LABELS = {
  bilibili_auto: 'B站 Index-Translate（自动优先）',
  bilibili_proxy: 'B站 Index-Translate（本地代理）',
  bilibili_direct: 'B站 Index-Translate（浏览器直连）',
  mymemory: '免代理免费翻译（MyMemory）',
  openai_compat: '自定义 OpenAI 兼容接口'
};

let readingTransConfig = { ...DEFAULT_READING_TRANS_CONFIG };
let readingProxyOnline = null; // null=未知 | true=在线 | false=离线
let readingProxyLastCheck = 0;
let readingFallbackNotified = false;
const readingDictCache = new Map();
let readingTransPopState = null; // { start, end, annId, quote, kind, context, translation, engine, phonetic, audioUrl, dictDef, loading, error }
let readingTransReqSeq = 0;
let readingCurrentAudio = null;

// =========================================================================
// 1. 配置持久化
// =========================================================================
function loadReadingTransConfig() {
  try {
    const raw = localStorage.getItem(LS_READING_TRANS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      readingTransConfig = { ...DEFAULT_READING_TRANS_CONFIG, ...(parsed || {}) };
    }
  } catch {
    readingTransConfig = { ...DEFAULT_READING_TRANS_CONFIG };
  }
}

function saveReadingTransConfig() {
  try {
    localStorage.setItem(LS_READING_TRANS_KEY, JSON.stringify(readingTransConfig));
  } catch {}
}

function getReadingTransEngineShortLabel() {
  const p = readingTransConfig.provider;
  if (p === 'bilibili_auto') return readingProxyOnline ? 'B站35B' : 'B站/免代理';
  if (p === 'bilibili_proxy') return 'B站代理';
  if (p === 'bilibili_direct') return 'B站直连';
  if (p === 'mymemory') return '免代理';
  if (p === 'openai_compat') return readingTransConfig.customModel || '自定义API';
  return '翻译';
}

function normalizeChatCompletionsUrl(baseUrl) {
  let u = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (/\/chat\/completions$/i.test(u)) return u;
  if (/\/v1$/i.test(u)) return u + '/chat/completions';
  return u + '/v1/chat/completions';
}

function normalizeProxyRoot(baseUrl) {
  return String(baseUrl || 'http://127.0.0.1:8080/v1')
    .trim()
    .replace(/\/chat\/completions\/?$/i, '')
    .replace(/\/v1\/?$/i, '')
    .replace(/\/+$/, '');
}

// =========================================================================
// 2. 探测本地 B站翻译代理状态
// =========================================================================
async function probeBilibiliProxy(force = false) {
  const now = Date.now();
  if (!force && readingProxyOnline !== null && now - readingProxyLastCheck < 12000) {
    return readingProxyOnline;
  }
  const root = normalizeProxyRoot(readingTransConfig.proxyBaseUrl);
  if (!root) {
    readingProxyOnline = false;
    readingProxyLastCheck = now;
    updateProxyStatusIndicators();
    return false;
  }

  const checkUrl = async (url) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1400);
    try {
      const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      clearTimeout(timer);
      return false;
    }
  };

  let ok = await checkUrl(root + '/health');
  if (!ok) ok = await checkUrl(root + '/v1/models');
  readingProxyOnline = ok;
  readingProxyLastCheck = Date.now();
  updateProxyStatusIndicators();
  return ok;
}

function updateProxyStatusIndicators() {
  const badge = document.getElementById('rd-proxy-status-badge');
  if (badge) {
    if (readingProxyOnline === true) {
      badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200';
      badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>本地 B站代理已连接';
    } else if (readingProxyOnline === false) {
      badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200';
      badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>本地代理未启动';
    } else {
      badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200';
      badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>检测中…';
    }
  }
  const dot = document.getElementById('rd-trans-btn-dot');
  if (dot) {
    const isBili = readingTransConfig.provider === 'bilibili_auto' || readingTransConfig.provider === 'bilibili_proxy';
    dot.className = 'w-1.5 h-1.5 rounded-full shrink-0 ' + (
      isBili
        ? (readingProxyOnline ? 'bg-emerald-500' : 'bg-amber-400')
        : 'bg-blue-500'
    );
  }
}

// =========================================================================
// 3. 翻译核心引擎
// =========================================================================
function buildTranslatePrompt(text, kind, context) {
  const style = readingTransConfig.style || 'kaoyan';
  if (kind === 'word') {
    if (context && context.trim() && context.trim() !== text.trim()) {
      return `请结合下面英文例句语境，给出单词 "${text}" 在考研英语中的准确中文释义（格式：词性. 语境义；如有常见其他义项可简略补充）。直接输出精炼中文释义，不要多余解释或思考过程。\n例句：${context.trim()}`;
    }
    return `请给出英文单词 "${text}" 在考研英语中的常见中文释义（格式：词性. 释义；如有高频熟词僻义可补充）。直接输出精炼结果，不要多余解释或思考过程。`;
  }
  if (kind === 'phrase') {
    return `请将以下英文短语准确翻译为简明中文释义，直接输出结果，不要添加任何解释或思考过程：\n\n${text}`;
  }
  if (style === 'literal') {
    return `请将以下英文尽量贴近原句结构和词序直译为中文，便于对照学习长难句语法。直接输出中文译文，不要添加标题、解释或思考过程：\n\n${text}`;
  }
  if (style === 'natural') {
    return `请将以下英文意译为自然地道、流畅易读的中文。直接输出中文译文，不要添加标题、解释或思考过程：\n\n${text}`;
  }
  return `请将以下考研英语阅读文本准确翻译为通顺严谨的中文（忠实原意、理清从句与逻辑关系）。直接输出中文译文，不要添加任何前言、注释或思考过程：\n\n${text}`;
}

function cleanLlmTranslation(raw) {
  let s = String(raw || '');
  // 去除推理模型可能返回的 <think>...</think> 思考过程
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<think>[\s\S]*$/gi, '');
  s = s.trim();
  // 去掉首尾多余的对称引号（仅当整段被一对引号包住时）
  if ((s.startsWith('“') && s.endsWith('”')) || (s.startsWith('"') && s.endsWith('"'))) {
    const inner = s.slice(1, -1).trim();
    if (inner && !inner.includes('"')) s = inner;
  }
  return s;
}

async function callOpenAICompatTranslate({ url, model, apiKey, prompt, isBilibili, signal, timeoutMs = 45000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) { clearTimeout(timer); throw new DOMException('Aborted', 'AbortError'); }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const body = {
      model,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }]
    };
    if (isBilibili) {
      body.chat_template_kwargs = { enable_thinking: false };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal
    });

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson && errJson.error && errJson.error.message) errMsg = errJson.error.message;
        else if (errJson && errJson.message) errMsg = errJson.message;
      } catch {}
      throw new Error(errMsg);
    }

    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    const cleaned = cleanLlmTranslation(content);
    if (!cleaned) throw new Error('接口返回内容为空');
    return cleaned;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// 将较长英文段落按句切分为每块 <= 420 字符，满足 MyMemory 单次 500 字符限制
function splitTextForMyMemory(text, maxLen = 420) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return [clean];
  const sentences = clean.match(/[^.!?。！？]+[.!?。！？]+["'”’)\]]*\s*|[^.!?。！？]+$/g) || [clean];
  const chunks = [];
  let buf = '';
  for (const s of sentences) {
    const part = s.trim();
    if (!part) continue;
    if (buf && (buf.length + 1 + part.length) > maxLen) {
      chunks.push(buf);
      buf = part;
    } else if (!buf && part.length > maxLen) {
      // 超长单句按逗号/空格硬切
      let remain = part;
      while (remain.length > maxLen) {
        let cut = remain.lastIndexOf(',', maxLen);
        if (cut < maxLen * 0.4) cut = remain.lastIndexOf(' ', maxLen);
        if (cut < maxLen * 0.4) cut = maxLen;
        chunks.push(remain.slice(0, cut + 1).trim());
        remain = remain.slice(cut + 1).trim();
      }
      buf = remain;
    } else {
      buf = buf ? (buf + ' ' + part) : part;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [clean];
}

function decodeBasicEntities(str) {
  const ta = document.createElement('textarea');
  ta.innerHTML = String(str || '');
  return ta.value;
}

async function callMyMemoryTranslate(text, signal) {
  const chunks = splitTextForMyMemory(text, 420);
  const results = [];
  for (const chunk of chunks) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 18000);
    const onAbort = () => ctrl.abort();
    if (signal) {
      if (signal.aborted) { clearTimeout(timer); throw new DOMException('Aborted', 'AbortError'); }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=en|zh-CN`;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
      const data = await res.json();
      if (data && data.responseStatus && Number(data.responseStatus) >= 400) {
        throw new Error(data.responseDetails || 'MyMemory 额度暂满或请求受限');
      }
      const translated = data && data.responseData ? decodeBasicEntities(data.responseData.translatedText || '') : '';
      if (!translated) throw new Error('MyMemory 返回为空');
      results.push(translated.trim());
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
  return results.join('');
}

// 统一对外翻译入口：返回 { text, engine, fellBack? }
async function translateReadingText(text, opts = {}) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('待翻译文本为空');
  const kind = opts.kind || (typeof detectReadingKind === 'function' ? detectReadingKind(clean) : 'sentence');
  const context = opts.context || '';
  const signal = opts.signal || null;
  const provider = readingTransConfig.provider || 'bilibili_auto';
  const prompt = buildTranslatePrompt(clean, kind, context);
  const biliModel = (readingTransConfig.bilibiliModel || BILIBILI_DEFAULT_MODEL).trim();

  if (provider === 'mymemory') {
    const out = await callMyMemoryTranslate(clean, signal);
    return { text: out, engine: '免代理翻译 (MyMemory)' };
  }

  if (provider === 'openai_compat') {
    const url = normalizeChatCompletionsUrl(readingTransConfig.customBaseUrl);
    const model = String(readingTransConfig.customModel || '').trim();
    if (!url || !model) throw new Error('请先在「翻译设置」中填写自定义 API 地址和模型名称');
    const out = await callOpenAICompatTranslate({
      url,
      model,
      apiKey: String(readingTransConfig.customApiKey || '').trim(),
      prompt,
      isBilibili: false,
      signal
    });
    return { text: out, engine: model };
  }

  if (provider === 'bilibili_proxy') {
    const url = normalizeChatCompletionsUrl(readingTransConfig.proxyBaseUrl || 'http://127.0.0.1:8080/v1');
    try {
      const out = await callOpenAICompatTranslate({
        url,
        model: biliModel,
        apiKey: 'index',
        prompt,
        isBilibili: true,
        signal
      });
      readingProxyOnline = true;
      readingProxyLastCheck = Date.now();
      updateProxyStatusIndicators();
      return { text: out, engine: `B站 ${biliModel}` };
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      readingProxyOnline = false;
      updateProxyStatusIndicators();
      throw new Error(`无法连接本地 B站代理 (${url})。请双击项目根目录的「启动B站免费翻译.bat」，或在「翻译设置」切换免代理引擎。`);
    }
  }

  if (provider === 'bilibili_direct') {
    const url = normalizeChatCompletionsUrl(BILIBILI_DIRECT_BASE);
    try {
      const out = await callOpenAICompatTranslate({
        url,
        model: biliModel,
        apiKey: '',
        prompt,
        isBilibili: true,
        signal
      });
      return { text: out, engine: `B站 ${biliModel} (直连)` };
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new Error('浏览器直连 B站接口受跨域 (CORS) 限制。请双击「启动B站免费翻译.bat」并切换为「自动优先 / 本地代理」。');
    }
  }

  // 默认模式：bilibili_auto（优先本地 B站代理 → 尝试直连 → 自动回退免代理 MyMemory）
  const proxyOk = await probeBilibiliProxy(false);
  if (proxyOk) {
    try {
      const url = normalizeChatCompletionsUrl(readingTransConfig.proxyBaseUrl || 'http://127.0.0.1:8080/v1');
      const out = await callOpenAICompatTranslate({
        url,
        model: biliModel,
        apiKey: 'index',
        prompt,
        isBilibili: true,
        signal
      });
      return { text: out, engine: `B站 ${biliModel}` };
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      readingProxyOnline = false;
      updateProxyStatusIndicators();
    }
  }

  // 尝试直连 B站（若用户浏览器放开了 CORS 或上游开放了 CORS 即可直接生效）
  try {
    const out = await callOpenAICompatTranslate({
      url: normalizeChatCompletionsUrl(BILIBILI_DIRECT_BASE),
      model: biliModel,
      apiKey: '',
      prompt,
      isBilibili: true,
      signal,
      timeoutMs: 8000
    });
    return { text: out, engine: `B站 ${biliModel} (直连)` };
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
  }

  // 自动回退到免代理在线翻译，保证零配置开箱可用
  const out = await callMyMemoryTranslate(clean, signal);
  if (!readingFallbackNotified && !opts.silentFallbackToast) {
    readingFallbackNotified = true;
    showToast('未检测到本地 B站代理，已自动用免代理翻译；双击「启动B站免费翻译.bat」可启用 B站 35B 大模型', 'info');
  }
  return { text: out, engine: '免代理兜底 (MyMemory)', fellBack: true };
}

// =========================================================================
// 4. 英文单词音标查询（Free Dictionary API）与英语朗读（TTS）
// =========================================================================
async function lookupEnglishWordDict(rawWord) {
  const clean = String(rawWord || '').trim().toLowerCase().replace(/^[^a-z]+|[^a-z'-]+$/g, '');
  if (!clean || /\s/.test(clean) || clean.length > 35) return null;
  if (readingDictCache.has(clean)) return readingDictCache.get(clean);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(clean)}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) { readingDictCache.set(clean, null); return null; }
    const arr = await res.json();
    const entry = Array.isArray(arr) ? arr[0] : null;
    if (!entry) { readingDictCache.set(clean, null); return null; }
    let phonetic = entry.phonetic || '';
    let audioUrl = '';
    if (Array.isArray(entry.phonetics)) {
      for (const p of entry.phonetics) {
        if (!phonetic && p.text) phonetic = p.text;
        if (!audioUrl && p.audio) audioUrl = p.audio;
      }
    }
    let pos = '';
    let def = '';
    if (Array.isArray(entry.meanings) && entry.meanings[0]) {
      pos = entry.meanings[0].partOfSpeech || '';
      const d0 = entry.meanings[0].definitions && entry.meanings[0].definitions[0];
      if (d0 && d0.definition) def = d0.definition;
    }
    const info = { phonetic, audioUrl, pos, def };
    readingDictCache.set(clean, info);
    return info;
  } catch {
    return null;
  }
}

function speakEnglishText(text, audioUrl) {
  const clean = String(text || '').trim();
  if (!clean) return;
  // 先停止前一个音频/语音
  if (readingCurrentAudio) {
    try { readingCurrentAudio.pause(); } catch {}
    readingCurrentAudio = null;
  }
  if (window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch {}
  }

  const fallbackTts = () => {
    if (!window.speechSynthesis) {
      showToast('当前浏览器不支持语音朗读', 'warning');
      return;
    }
    try {
      const utter = new SpeechSynthesisUtterance(clean);
      utter.lang = 'en-US';
      utter.rate = clean.split(/\s+/).length <= 3 ? 0.9 : 0.96;
      const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
      const enVoice = voices.find(v => /^en[-_]US/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang));
      if (enVoice) utter.voice = enVoice;
      window.speechSynthesis.speak(utter);
    } catch {
      showToast('语音朗读启动失败', 'warning');
    }
  };

  if (audioUrl) {
    try {
      const audio = new Audio(audioUrl);
      readingCurrentAudio = audio;
      audio.onerror = fallbackTts;
      audio.play().catch(fallbackTts);
      return;
    } catch {}
  }
  fallbackTts();
}

// =========================================================================
// 5. 划词即时翻译浮层 (#readingTransPopover)
// =========================================================================
function hideReadingTransPopover() {
  const pop = document.getElementById('readingTransPopover');
  if (pop) pop.classList.add('hidden');
  readingTransPopState = null;
}

function extractSentenceContextAt(text, start, end) {
  if (!text) return '';
  let s = Math.max(0, start);
  let e = Math.min(text.length, end);
  while (s > 0 && text[s - 1] !== '\n' && !/[.!?。！？]/.test(text[s - 1])) s--;
  while (e < text.length && text[e] !== '\n' && !/[.!?。！？]/.test(text[e])) e++;
  if (e < text.length && /[.!?。！？]/.test(text[e])) e++;
  return text.slice(s, e).trim().slice(0, 320);
}

function openReadingTransPopover({ start, end, annId, quote, rect }) {
  const pop = document.getElementById('readingTransPopover');
  if (!pop) return;
  const r = typeof getCurrentReading === 'function' ? getCurrentReading() : null;
  const kind = typeof detectReadingKind === 'function' ? detectReadingKind(quote) : 'sentence';
  const context = (kind === 'word' && r && Number.isFinite(start))
    ? extractSentenceContextAt(r.text, start, end)
    : '';

  const seq = ++readingTransReqSeq;
  readingTransPopState = {
    start, end, annId: annId || '', quote, kind, context,
    translation: '', engine: '', phonetic: '', audioUrl: '', dictDef: '',
    loading: true, error: ''
  };
  renderReadingTransPopover();
  positionReadingTransPopover(rect);

  // 如果是单词，并行查询英文音标与发音
  if (kind === 'word') {
    lookupEnglishWordDict(quote).then(info => {
      if (seq !== readingTransReqSeq || !readingTransPopState || !info) return;
      readingTransPopState.phonetic = info.phonetic || '';
      readingTransPopState.audioUrl = info.audioUrl || '';
      readingTransPopState.dictDef = info.def ? `${info.pos ? info.pos + '. ' : ''}${info.def}` : '';
      renderReadingTransPopover();
    });
  }

  // 请求外接翻译
  translateReadingText(quote, { kind, context }).then(res => {
    if (seq !== readingTransReqSeq || !readingTransPopState) return;
    readingTransPopState.loading = false;
    readingTransPopState.translation = res.text;
    readingTransPopState.engine = res.engine;
    readingTransPopState.error = '';
    renderReadingTransPopover();
  }).catch(err => {
    if (seq !== readingTransReqSeq || !readingTransPopState) return;
    readingTransPopState.loading = false;
    readingTransPopState.error = (err && err.message) ? err.message : '翻译请求失败';
    renderReadingTransPopover();
  });
}

function retryReadingTransPopover() {
  if (!readingTransPopState) return;
  const pop = document.getElementById('readingTransPopover');
  const rect = pop ? pop.getBoundingClientRect() : { top: 120, bottom: 160, left: 200, width: 200 };
  openReadingTransPopover({
    start: readingTransPopState.start,
    end: readingTransPopState.end,
    annId: readingTransPopState.annId,
    quote: readingTransPopState.quote,
    rect
  });
}

function positionReadingTransPopover(rect) {
  const pop = document.getElementById('readingTransPopover');
  if (!pop) return;
  pop.classList.remove('hidden');
  const pw = pop.offsetWidth || 360;
  const ph = pop.offsetHeight || 200;
  let top = (rect ? rect.bottom : 140) + 10;
  if (top + ph > window.innerHeight - 12) {
    top = Math.max(12, (rect ? rect.top : 260) - ph - 10);
  }
  let left = (rect ? (rect.left + rect.width / 2) : window.innerWidth / 2) - pw / 2;
  left = Math.max(12, Math.min(window.innerWidth - pw - 12, left));
  pop.style.top = top + 'px';
  pop.style.left = left + 'px';
}

function renderReadingTransPopover() {
  const pop = document.getElementById('readingTransPopover');
  const st = readingTransPopState;
  if (!pop || !st) return;

  const qEncoded = encodeURIComponent(st.quote);
  const youdaoUrl = `https://dict.youdao.com/result?word=${qEncoded}&lang=en`;
  const cambridgeUrl = `https://dictionary.cambridge.org/dictionary/english-chinese-simplified/${encodeURIComponent(st.quote.trim().toLowerCase())}`;
  const deeplUrl = `https://www.deepl.com/translator#en/zh/${qEncoded}`;
  const kindLabel = (typeof READING_KIND_NAMES !== 'undefined' && READING_KIND_NAMES[st.kind]) ? READING_KIND_NAMES[st.kind] : '片段';

  pop.innerHTML = `
    <div class="px-3.5 py-2.5 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between gap-2 rounded-t-2xl">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="text-xs font-bold text-blue-700">🌐 即时翻译</span>
        <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200/70 text-slate-600">${kindLabel}</span>
        ${st.engine ? `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 truncate max-w-[140px]" title="${escapeHtml(st.engine)}">${escapeHtml(st.engine)}</span>` : ''}
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <button onclick="openReadingTransModal()" class="w-6 h-6 rounded-md text-xs text-slate-400 hover:bg-slate-200/70 hover:text-slate-700" title="翻译接口设置">⚙️</button>
        <button onclick="hideReadingTransPopover()" class="w-6 h-6 rounded-md text-xs text-slate-400 hover:bg-slate-200/70 hover:text-slate-700" title="关闭 (Esc)">✕</button>
      </div>
    </div>
    <div class="p-3.5 space-y-2.5">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="font-serif ${st.kind === 'word' ? 'text-base font-bold' : 'text-[13px]'} text-slate-800 leading-snug line-clamp-3 break-words">${escapeHtml(st.quote)}</div>
          ${st.phonetic ? `<div class="mt-0.5 text-xs text-slate-500 font-mono">${escapeHtml(st.phonetic)}</div>` : ''}
        </div>
        <button onclick="speakCurrentPopText()" class="btn-tactile shrink-0 px-2 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-blue-700" title="英语朗读">🔊</button>
      </div>

      ${st.loading ? `
        <div class="p-3 rounded-xl bg-blue-50/50 border border-blue-100 text-xs text-blue-700 flex items-center gap-2">
          <span class="rd-spinner"></span>
          <span>正在调用 ${escapeHtml(getReadingTransEngineShortLabel())} 翻译…</span>
        </div>`
      : st.error ? `
        <div class="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 space-y-2">
          <div class="leading-relaxed">${escapeHtml(st.error)}</div>
          <div class="flex flex-wrap gap-1.5">
            <button onclick="retryReadingTransPopover()" class="btn-tactile px-2.5 py-1 rounded-lg bg-white border border-rose-200 text-rose-700 font-semibold hover:bg-rose-100">🔄 重试</button>
            <button onclick="switchToMyMemoryAndRetry()" class="btn-tactile px-2.5 py-1 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">改用免代理翻译</button>
            <button onclick="openReadingTransModal()" class="btn-tactile px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-100">⚙️ 设置</button>
          </div>
        </div>`
      : `
        <div class="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/80 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap break-words">${escapeHtml(st.translation)}</div>
        ${st.dictDef ? `<div class="text-[11px] text-slate-500 leading-relaxed px-1"><span class="font-semibold text-slate-600">英英：</span>${escapeHtml(st.dictDef)}</div>` : ''}
        <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
          <button onclick="saveReadingTransToAnn(false)" class="btn-tactile px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-sm">📌 存为高亮批注</button>
          <button onclick="saveReadingTransToAnn(true)" class="btn-tactile px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">✏️ 写详细笔记</button>
          <button onclick="copyReadingTransPopText()" class="btn-tactile px-2 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200" title="复制译文">📋</button>
          <button onclick="retryReadingTransPopover()" class="btn-tactile px-2 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200" title="重新翻译">🔄</button>
        </div>`}

      <div class="pt-1.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
        <span>外部权威查词：</span>
        <div class="flex items-center gap-2">
          <a href="${youdaoUrl}" target="_blank" rel="noopener noreferrer" class="text-slate-500 hover:text-blue-600 font-medium">有道</a>
          ${st.kind === 'word' ? `<a href="${cambridgeUrl}" target="_blank" rel="noopener noreferrer" class="text-slate-500 hover:text-blue-600 font-medium">剑桥</a>` : ''}
          <a href="${deeplUrl}" target="_blank" rel="noopener noreferrer" class="text-slate-500 hover:text-blue-600 font-medium">DeepL</a>
        </div>
      </div>
    </div>`;
}

function speakCurrentPopText() {
  if (!readingTransPopState) return;
  speakEnglishText(readingTransPopState.quote, readingTransPopState.audioUrl);
}

function copyReadingTransPopText() {
  if (!readingTransPopState || !readingTransPopState.translation) return;
  const txt = readingTransPopState.translation;
  const done = () => showToast('已复制译文', 'success');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(txt).then(done).catch(() => fallbackCopy(txt, done));
  } else {
    fallbackCopy(txt, done);
  }
}

function switchToMyMemoryAndRetry() {
  readingTransConfig.provider = 'mymemory';
  saveReadingTransConfig();
  updateProxyStatusIndicators();
  retryReadingTransPopover();
}

function saveReadingTransToAnn(openModal) {
  const st = readingTransPopState;
  if (!st || !st.translation) return;
  const r = typeof getCurrentReading === 'function' ? getCurrentReading() : null;
  if (!r) return;

  let ann = null;
  if (st.annId) {
    ann = r.annotations.find(a => a.id === st.annId);
  }
  if (!ann && Number.isFinite(st.start) && Number.isFinite(st.end) && st.end > st.start) {
    ann = r.annotations.find(a => a.start === st.start && a.end === st.end);
    if (!ann) {
      ann = {
        id: genId('ann'),
        start: st.start,
        end: st.end,
        quote: r.text.slice(st.start, st.end),
        color: st.kind === 'word' ? 'yellow' : st.kind === 'phrase' ? 'green' : 'blue',
        kind: st.kind,
        meaning: '',
        comment: '',
        createdAt: Date.now()
      };
      r.annotations.push(ann);
    }
  }
  if (!ann) return;

  const meaningText = st.phonetic ? `${st.phonetic}  ${st.translation}` : st.translation;
  ann.meaning = meaningText;
  r.updatedAt = Date.now();
  hideReadingTransPopover();
  if (typeof afterReadingAnnChange === 'function') afterReadingAnnChange();
  if (openModal && typeof openReadingNoteModal === 'function') {
    openReadingNoteModal(ann.id);
  } else {
    showToast('已高亮并写入释义/译文', 'success');
  }
}

// =========================================================================
// 6. 批注弹窗内一键翻译
// =========================================================================
async function translateInNoteModal() {
  const quoteEl = document.getElementById('rdn-quote');
  const meaningEl = document.getElementById('rdn-meaning');
  const kindEl = document.getElementById('rdn-kind');
  const btn = document.getElementById('rdn-trans-btn');
  if (!quoteEl || !meaningEl) return;
  const quote = quoteEl.textContent.trim();
  if (!quote) return;

  const oldHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ 翻译中…'; }
  try {
    const kind = kindEl ? kindEl.value : 'sentence';
    const annId = document.getElementById('rdn-id').value;
    const r = typeof getCurrentReading === 'function' ? getCurrentReading() : null;
    const ann = r && annId ? r.annotations.find(a => a.id === annId) : null;
    const context = (kind === 'word' && r && ann) ? extractSentenceContextAt(r.text, ann.start, ann.end) : '';

    const [res, dict] = await Promise.all([
      translateReadingText(quote, { kind, context }),
      kind === 'word' ? lookupEnglishWordDict(quote) : Promise.resolve(null)
    ]);
    meaningEl.value = (dict && dict.phonetic) ? `${dict.phonetic}  ${res.text}` : res.text;
    showToast(`翻译完成（${res.engine}）`, 'success');
  } catch (err) {
    showToast(err && err.message ? err.message : '翻译失败', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
  }
}

// =========================================================================
// 7. 翻译设置弹窗 (#readingTransModal)
// =========================================================================
function openReadingTransModal() {
  const modal = document.getElementById('readingTransModal');
  if (!modal) return;
  document.getElementById('rdt-provider').value = readingTransConfig.provider;
  document.getElementById('rdt-proxy-url').value = readingTransConfig.proxyBaseUrl;
  document.getElementById('rdt-bili-model').value = readingTransConfig.bilibiliModel;
  document.getElementById('rdt-custom-url').value = readingTransConfig.customBaseUrl;
  document.getElementById('rdt-custom-key').value = readingTransConfig.customApiKey;
  document.getElementById('rdt-custom-model').value = readingTransConfig.customModel;
  document.getElementById('rdt-style').value = readingTransConfig.style || 'kaoyan';
  const testBox = document.getElementById('rdt-test-result');
  if (testBox) { testBox.classList.add('hidden'); testBox.textContent = ''; }
  onReadingTransProviderChange();
  modal.classList.add('open');
  probeBilibiliProxy(true);
}

function closeReadingTransModal() {
  const modal = document.getElementById('readingTransModal');
  if (modal) modal.classList.remove('open');
}

function onReadingTransProviderChange() {
  const p = document.getElementById('rdt-provider').value;
  const biliBox = document.getElementById('rdt-bili-fields');
  const customBox = document.getElementById('rdt-custom-fields');
  const proxyWrap = document.getElementById('rdt-proxy-url-wrap');
  const styleWrap = document.getElementById('rdt-style-wrap');
  if (biliBox) biliBox.classList.toggle('hidden', !['bilibili_auto', 'bilibili_proxy', 'bilibili_direct'].includes(p));
  if (proxyWrap) proxyWrap.classList.toggle('hidden', p === 'bilibili_direct');
  if (customBox) customBox.classList.toggle('hidden', p !== 'openai_compat');
  if (styleWrap) styleWrap.classList.toggle('hidden', p === 'mymemory');
}

function applyReadingTransFormToConfig() {
  readingTransConfig.provider = document.getElementById('rdt-provider').value;
  readingTransConfig.proxyBaseUrl = document.getElementById('rdt-proxy-url').value.trim() || 'http://127.0.0.1:8080/v1';
  readingTransConfig.bilibiliModel = document.getElementById('rdt-bili-model').value.trim() || BILIBILI_DEFAULT_MODEL;
  readingTransConfig.customBaseUrl = document.getElementById('rdt-custom-url').value.trim();
  readingTransConfig.customApiKey = document.getElementById('rdt-custom-key').value.trim();
  readingTransConfig.customModel = document.getElementById('rdt-custom-model').value.trim();
  readingTransConfig.style = document.getElementById('rdt-style').value || 'kaoyan';
  readingFallbackNotified = false;
  saveReadingTransConfig();
}

function saveReadingTransModal() {
  applyReadingTransFormToConfig();
  closeReadingTransModal();
  probeBilibiliProxy(true);
  if (typeof renderReadingReader === 'function') renderReadingReader();
  showToast(`已保存翻译设置：${READING_TRANS_PROVIDER_LABELS[readingTransConfig.provider] || ''}`, 'success');
}

async function testReadingTranslate() {
  applyReadingTransFormToConfig();
  const box = document.getElementById('rdt-test-result');
  const btn = document.getElementById('rdt-test-btn');
  if (!box) return;
  box.className = 'p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-700 leading-relaxed';
  box.textContent = '⏳ 正在测试翻译连接…';
  if (btn) btn.disabled = true;
  const sample = 'While technology reshapes how people work, critical thinking remains indispensable.';
  const t0 = performance.now();
  try {
    await probeBilibiliProxy(true);
    const res = await translateReadingText(sample, { kind: 'sentence', silentFallbackToast: true });
    const ms = Math.round(performance.now() - t0);
    box.className = 'p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 leading-relaxed space-y-1';
    box.innerHTML = `
      <div class="font-bold">✅ 测试成功（${escapeHtml(res.engine)} · ${ms}ms）</div>
      <div class="text-slate-500 font-serif">${escapeHtml(sample)}</div>
      <div class="text-slate-800 font-medium">${escapeHtml(res.text)}</div>`;
  } catch (err) {
    box.className = 'p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 leading-relaxed';
    box.textContent = '❌ 测试失败：' + (err && err.message ? err.message : '请求异常');
  } finally {
    if (btn) btn.disabled = false;
  }
}

loadReadingTransConfig();
