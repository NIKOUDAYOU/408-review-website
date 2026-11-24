// Markdown 渲染与 KaTeX 公式
// 由 408_v4.html 拆分而来：普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

// ===================== Markdown 渲染（备注 / 反思专用） =====================
// 行内语法：输入已 escapeHtml，输出安全 HTML
    // Markdown 行内语法解析（加粗/斜体/删除线/代码/链接），输入为已转义文本
function mdInline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\n])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, href) => {
      if (/^\s*(javascript|vbscript|data)\s*:/i.test(href)) return txt;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
    });
}

// 块级解析：标题 / 列表 / 引用 / 代码块 / 表格 / 分隔线 / 段落（单换行 → <br>）
    // Markdown 块级解析主循环：标题/列表/引用/代码块/表格/分隔线/段落
function mdRender(src) {
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
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码块 ```
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
    // 引用 >
    if (/^\s*&gt;/.test(line)) {
      closeLists();
      const buf = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*&gt;\s?/, ''));
        i++;
      }
      out.push(`<blockquote class="md-quote"><p class="md-p">${buf.map(mdInline).join('<br>')}</p></blockquote>`);
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
    // 列表项（2 空格 = 一层嵌套，嵌套列表包在父级 <li> 内）
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
      out.push(`<li>${mdInline(li[3])}`);
      liOpenStack[liOpenStack.length - 1] = true;
      i++; continue;
    }
    // 段落：连续非空行合并，单换行转 <br>（兼容旧纯文本备注的换行习惯）
    closeLists();
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() &&
      !/^\s*(#{1,6}\s|```|&gt;|([-*+]|\d+[.)])\s)/.test(lines[i]) &&
      !/^\s*([-*_])\s*(\1\s*){2,}$/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push(`<p class="md-p">${buf.map(mdInline).join('<br>')}</p>`);
  }
  closeLists();
  return out.join('');
}

// 公共入口：先保护数学公式 → 整体转义 HTML → 渲染 Markdown → 还原公式
const mathStore = [];
    // Markdown 渲染总入口：先提取保护数学公式，再整体转义+块级渲染，最后还原公式给 KaTeX
function renderMarkdown(text) {
  mathStore.length = 0;
  // 提取公式：$$...$$（独立公式，可跨行）与 $...$（行内公式，不跨行），
  // 用占位符顶替，避免 TeX 里的 * _ | 等符号被 Markdown 语法误伤
  const masked = String(text || '')
    .replace(/\$\$([\s\S]+?)\$\$/g, m => { mathStore.push({ tex: m, display: true }); return `⟦M${mathStore.length - 1}⟧`; })
    .replace(/\$([^\$\n]+?)\$/g, m => { mathStore.push({ tex: m, display: false }); return `⟦M${mathStore.length - 1}⟧`; });
  const escaped = escapeHtml(masked).trim();
  if (!escaped) return '';
  const html = mdRender(escaped);
  // 还原公式原文（含 $ 分隔符），交给 KaTeX auto-render 扫描渲染
  return html.replace(/⟦M(\d+)⟧/g, (m, idx) => {
    const item = mathStore[+idx];
    if (!item) return '';
    const esc = escapeHtml(item.tex);
    return item.display ? `<span class="md-math-display">${esc}</span>` : esc;
  });
}

// KaTeX 扫描选项
const KATEX_OPTS = {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '$', right: '$', display: false }
  ],
  ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
  throwOnError: false
};

// 对单个已注入 DOM 的 Markdown 容器渲染公式
    // 对已注入 DOM 的 .md-body 容器调用 KaTeX 扫描并渲染公式（加载失败则降级显示原文）
function renderMathIn(el) {
  if (el && window.renderMathInElement) {
    try { window.renderMathInElement(el, KATEX_OPTS); } catch (e) { /* 降级：保留原文 */ }
  }
}

// KaTeX 加载完成后全量补渲染（处理脚本先于 KaTeX 就绪渲染的内容）
window.renderMathAll = function () {
  if (!window.renderMathInElement) return;
  document.querySelectorAll('.md-body').forEach(el => renderMathIn(el));
  if (typeof markNoteOverflows === 'function') markNoteOverflows(document);
};
