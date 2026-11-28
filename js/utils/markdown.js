// Markdown 渲染与 KaTeX 公式
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// ===================== Markdown 渲染（备注 / 反思专用） =====================
// 行内语法：输入已 escapeHtml，输出安全 HTML
// Markdown 行内语法解析（加粗/斜体/删除线/高亮/行内代码占位/链接），输入为已转义文本
function mdInline(s) {
  return s
    .replace(/==([^=\n]+)==/g, '<mark class="md-mark">$1</mark>')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\n])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, href) => {
      if (/^\s*(javascript|vbscript|data)\s*:/i.test(href)) return txt;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
    });
}

// 提示框 / 避坑框映射
const MD_CALLOUT_MAP = {
  TIP: { cls: 'tip', icon: '💡', title: '思路提示' },
  WARN: { cls: 'warn', icon: '⚠️', title: '易错避坑' },
  WARNING: { cls: 'warn', icon: '⚠️', title: '易错避坑' },
  PITFALL: { cls: 'warn', icon: '⚠️', title: '易错避坑' },
  KEY: { cls: 'key', icon: '📌', title: '核心结论' },
  NOTE: { cls: 'note', icon: '📝', title: '补充说明' }
};

// 块级解析：标题 / 列表(含任务清单) / 引用(含提示框) / 代码块占位 / 独立公式占位 / 表格 / 分隔线 / 段落
function mdRender(src, mathStoreRef = []) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const listStack = [];
  const liOpenStack = []; // 与 listStack 平行：每层列表是否有未闭合 <li>
  const closeLists = (to = 0) => {
    while (liOpenStack.length > to) {
      if (liOpenStack.pop()) out.push('</li>');
      out.push(listStack.pop() === 'ol' ? '</ol>' : '</ul>');
    }
  };
  const splitRow = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const isStandaloneCodeBlock = (ln) => /^\s*⟦CB\d+⟧\s*$/.test(ln);
  const isStandaloneDisplayMath = (ln) => {
    const m = ln.trim().match(/^⟦M(\d+)⟧$/);
    return Boolean(m && mathStoreRef[+m[1]] && mathStoreRef[+m[1]].display);
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 独立代码块占位符 ⟦CBn⟧
    if (isStandaloneCodeBlock(line)) {
      closeLists();
      out.push(line.trim());
      i++;
      continue;
    }
    // 独立公式块占位符 ⟦Mn⟧（display: true）
    if (isStandaloneDisplayMath(line)) {
      closeLists();
      out.push(`<div class="md-math-block">${line.trim()}</div>`);
      i++;
      continue;
    }
    // 兼容未闭合的围栏代码块 ```
    if (/^\s*```/.test(line)) {
      closeLists();
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre class="md-pre"><code>${buf.join('\n')}</code></pre>`);
      continue;
    }
    // 空行
    if (!line.trim()) { closeLists(); i++; continue; }
    // 标题
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      closeLists();
      const lv = h[1].length;
      out.push(`<h${lv} class="md-h md-h${lv}">${mdInline(h[2])}</h${lv}>`);
      i++; continue;
    }
    // 分隔线 --- / *** / ___
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) { closeLists(); out.push('<hr class="md-hr">'); i++; continue; }
    // 引用 > （支持 > [!TIP] / > [!WARN] / > [!KEY] / > [!NOTE]）
    if (/^\s*&gt;/.test(line)) {
      closeLists();
      const buf = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*&gt;\s?/, ''));
        i++;
      }
      const calloutMatch = buf[0] && buf[0].match(/^\[!(TIP|WARN|WARNING|KEY|NOTE|PITFALL)\](?:\s+(.*))?$/i);
      if (calloutMatch) {
        const meta = MD_CALLOUT_MAP[calloutMatch[1].toUpperCase()] || MD_CALLOUT_MAP.NOTE;
        const customTitle = (calloutMatch[2] || '').trim();
        const titleHtml = customTitle ? mdInline(customTitle) : meta.title;
        const bodyLines = buf.slice(1);
        out.push(
          `<blockquote class="md-quote md-callout md-callout-${meta.cls}">` +
            `<div class="md-callout-title">${meta.icon} ${titleHtml}</div>` +
            (bodyLines.length ? `<p class="md-p">${bodyLines.map(mdInline).join('<br>')}</p>` : '') +
          `</blockquote>`
        );
      } else {
        out.push(`<blockquote class="md-quote"><p class="md-p">${buf.map(mdInline).join('<br>')}</p></blockquote>`);
      }
      continue;
    }
    // 表格（当前行含 |，下一行为 |:---:| 形式分隔行）
    if (line.includes('|') && i + 1 < lines.length && /-\s*\|/.test(lines[i + 1]) && /^\s*\|?[\s:|-]+$/.test(lines[i + 1])) {
      closeLists();
      const header = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(c =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : (c.endsWith(':') ? 'right' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(splitRow(lines[i])); i++; }
      const alignAttr = (idx) => aligns[idx] ? ` style="text-align:${aligns[idx]}"` : '';
      out.push(
        `<table class="md-table"><thead><tr>${header.map((c, idx) => `<th${alignAttr(idx)}>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${
          rows.map(r => `<tr>${header.map((_, idx) => `<td${alignAttr(idx)}>${mdInline(r[idx] || '')}</td>`).join('')}</tr>`).join('')
        }</tbody></table>`);
      continue;
    }
    // 列表项（2 空格 = 一层嵌套，支持任务清单 - [ ] / - [x]）
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
    if (li) {
      const level = Math.floor(li[1].replace(/\t/g, '  ').length / 2);
      const want = /\d/.test(li[2][0]) ? 'ol' : 'ul';
      if (listStack.length > level + 1) closeLists(level + 1);
      if (listStack.length === level + 1 && listStack[listStack.length - 1] !== want) closeLists(level);
      while (listStack.length < level + 1) {
        const t = listStack.length === level ? want : 'ul';
        out.push(`<${t} class="md-list">`);
        listStack.push(t);
        liOpenStack.push(false);
      }
      if (liOpenStack[liOpenStack.length - 1]) out.push('</li>'); // 同级新条目：闭合上一条
      const task = li[3].match(/^\[([ xX])\]\s+(.+)$/);
      if (task) {
        const checked = task[1].toLowerCase() === 'x';
        out.push(`<li class="md-task ${checked ? 'md-task-done' : ''}"><span class="md-task-box" aria-hidden="true">${checked ? '✓' : ''}</span><span class="md-task-text">${mdInline(task[2])}</span>`);
      } else {
        out.push(`<li>${mdInline(li[3])}`);
      }
      liOpenStack[liOpenStack.length - 1] = true;
      i++; continue;
    }
    // 段落：连续非空行合并，单换行转 <br>（兼容旧纯文本备注的换行习惯）
    closeLists();
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() &&
      !isStandaloneCodeBlock(lines[i]) &&
      !isStandaloneDisplayMath(lines[i]) &&
      !/^\s*(#{1,6}\s|```|&gt;|([-*+]|\d+[.)])\s)/.test(lines[i]) &&
      !/^\s*([-*_])\s*(\1\s*){2,}$/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push(`<p class="md-p">${buf.map(mdInline).join('<br>')}</p>`);
  }
  closeLists();
  return out.join('');
}

// 公共入口：先保护代码（避免代码中 $ 被误伤）→ 保护 \$ 与公式 → 整体转义 HTML → 渲染 Markdown → 还原公式与代码
const mathStore = [];
function renderMarkdown(text) {
  mathStore.length = 0;
  const codeBlocks = [];
  const inlineCodes = [];

  let masked = String(text || '').replace(/\r\n?/g, '\n');

  // 1. 提取围栏代码块 ```...```，避免内部 $ / ** / # 被误解析
  masked = masked.replace(/^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm, (m, code) => {
    codeBlocks.push(code.replace(/\n$/, ''));
    return `\n⟦CB${codeBlocks.length - 1}⟧\n`;
  });

  // 2. 提取行内代码 `...`
  masked = masked.replace(/`([^`\n]+)`/g, (m, code) => {
    inlineCodes.push(code);
    return `⟦IC${inlineCodes.length - 1}⟧`;
  });

  // 3. 保护转义美元符号 \$
  masked = masked.replace(/\\\$/g, '⟦DOLLAR⟧');

  // 4. 提取公式：$$...$$ / \[...\]（块级，可跨行）与 $...$ / \(...\)（行内，不跨行）
  masked = masked
    .replace(/\$\$([\s\S]+?)\$\$/g, m => { mathStore.push({ tex: m, display: true }); return `⟦M${mathStore.length - 1}⟧`; })
    .replace(/\\\[([\s\S]+?)\\\]/g, m => { mathStore.push({ tex: m, display: true }); return `⟦M${mathStore.length - 1}⟧`; })
    .replace(/\$([^\$\n]+?)\$/g, m => { mathStore.push({ tex: m, display: false }); return `⟦M${mathStore.length - 1}⟧`; })
    .replace(/\\\(([^\n]+?)\\\)/g, m => { mathStore.push({ tex: m, display: false }); return `⟦M${mathStore.length - 1}⟧`; });

  const escaped = escapeHtml(masked).trim();
  if (!escaped) return '';
  const html = mdRender(escaped, mathStore);

  // 5. 还原公式、行内代码、代码块与字面美元符号
  return html
    .replace(/⟦M(\d+)⟧/g, (m, idx) => {
      const item = mathStore[+idx];
      if (!item) return '';
      const esc = escapeHtml(item.tex);
      return item.display ? `<span class="md-math-display">${esc}</span>` : esc;
    })
    .replace(/⟦IC(\d+)⟧/g, (m, idx) => `<code class="md-code">${escapeHtml(inlineCodes[+idx] || '')}</code>`)
    .replace(/⟦CB(\d+)⟧/g, (m, idx) => `<pre class="md-pre"><code>${escapeHtml(codeBlocks[+idx] || '')}</code></pre>`)
    .replace(/⟦DOLLAR⟧/g, '<span class="md-dollar">$</span>');
}

// KaTeX 扫描选项
const KATEX_OPTS = {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '$', right: '$', display: false },
    { left: '\\(', right: '\\)', display: false }
  ],
  ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
  throwOnError: false
};

// 对单个已注入 DOM 的 Markdown 容器渲染公式
function renderMathIn(el) {
  if (el && window.renderMathInElement) {
    try { window.renderMathInElement(el, KATEX_OPTS); } catch (e) { /* 降级：保留原文 */ }
  }
}

// 直接将一段 LaTeX 渲染到预览容器（供公式编辑器 / 矩阵生成器 / 符号速查使用）
function renderTexToEl(el, tex, displayMode = true) {
  if (!el) return { ok: false, error: 'missing target' };
  const raw = String(tex || '').trim();
  if (!raw) {
    el.innerHTML = '<span class="text-xs text-slate-400 italic">（输入或点击上方模板，此处实时渲染预览）</span>';
    return { ok: true, empty: true };
  }
  if (window.katex && typeof window.katex.render === 'function') {
    try {
      window.katex.render(raw, el, { displayMode, throwOnError: true, strict: 'ignore' });
      return { ok: true };
    } catch (err) {
      // 语法未输完时用 throwOnError:false 做温和渲染，并返回错误提示
      try {
        window.katex.render(raw, el, { displayMode, throwOnError: false, strict: 'ignore' });
      } catch (_) {
        el.textContent = raw;
      }
      return { ok: false, error: err && err.message ? err.message : '公式语法尚未完整' };
    }
  }
  el.textContent = displayMode ? `$$${raw}$$` : `$${raw}$`;
  return { ok: true, fallback: true };
}

// KaTeX 加载完成后全量补渲染（处理脚本先于 KaTeX 就绪渲染的内容）
window.renderMathAll = function () {
  if (!window.renderMathInElement) return;
  document.querySelectorAll('.md-body').forEach(el => renderMathIn(el));
  if (typeof markNoteOverflows === 'function') markNoteOverflows(document);
};
