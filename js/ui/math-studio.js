// 公式编辑器、可视化矩阵生成器与 LaTeX 中文俗称速查表
// 普通 <script> 加载（兼容 file:// 打开），函数与变量为全局共享

const LS_RECENT_LATEX_KEY = 'kaoyan_recent_latex_symbols';
const MS_MAX_RECENT = 14;
const MS_MAX_DIM = 6;

const mathStudioState = {
  taId: 'rec-note',
  tab: 'formula',
  displayMode: false,
  cursorStart: 0,
  cursorEnd: 0,
  replaceRange: null, // { start, end } 若光标位于已有公式内，确认后原位替换
  symInsertTarget: 'card', // 'card' | 'formula'
  symCat: 'all',
  symQuery: '',
  matrix: {
    type: 'pmatrix',
    rows: 3,
    cols: 3,
    augCol: 2,
    cells: [
      ['1', '0', '0'],
      ['0', '1', '0'],
      ['0', '0', '1']
    ]
  }
};

// ===================== 1. 常用结构片段 & 考研高频公式模板 =====================
const MS_FORMULA_SNIPPETS = [
  { label: '分式', tex: '\\frac{a}{b}', select: 'a' },
  { label: '根号', tex: '\\sqrt{x}', select: 'x' },
  { label: 'n次根', tex: '\\sqrt[n]{x}', select: 'n' },
  { label: '上标', tex: '^{2}', select: '2' },
  { label: '下标', tex: '_{i}', select: 'i' },
  { label: '上下标', tex: '_{i}^{2}', select: 'i' },
  { label: '极限', tex: '\\lim_{x \\to 0} ', select: '0' },
  { label: '定积分', tex: '\\int_{a}^{b} f(x)\\,dx', select: 'a' },
  { label: '二重积分', tex: '\\iint_{D} f(x,y)\\,d\\sigma', select: 'D' },
  { label: '求和', tex: '\\sum_{i=1}^{n} ', select: 'n' },
  { label: '连乘', tex: '\\prod_{i=1}^{n} ', select: 'n' },
  { label: '偏导', tex: '\\frac{\\partial y}{\\partial x}', select: 'y' },
  { label: '组合数', tex: '\\binom{n}{k}', select: 'n' },
  { label: '自适应括号', tex: '\\left( x \\right)', select: 'x' },
  { label: '分段函数', tex: '\\begin{cases}\nx, & x \\ge 0 \\\\\n-x, & x < 0\n\\end{cases}', select: 'x \\ge 0', display: true },
  { label: '多行对齐', tex: '\\begin{aligned}\nf(x) &= a \\\\\n&= b\n\\end{aligned}', select: 'f(x)', display: true }
];

const MS_EXAM_TEMPLATES = [
  { group: '高数', name: '泰勒展开 e^x', display: true, tex: 'e^x = 1 + x + \\frac{x^2}{2!} + \\cdots + \\frac{x^n}{n!} + o(x^n)' },
  { group: '高数', name: '泰勒 sin x', display: true, tex: '\\sin x = x - \\frac{x^3}{3!} + \\frac{x^5}{5!} + o(x^5)' },
  { group: '高数', name: '泰勒 ln(1+x)', display: true, tex: '\\ln(1+x) = x - \\frac{x^2}{2} + \\frac{x^3}{3} + o(x^3)' },
  { group: '高数', name: '分部积分', display: false, tex: '\\int u\\,dv = uv - \\int v\\,du' },
  { group: '高数', name: '洛必达法则', display: true, tex: '\\lim_{x \\to a} \\frac{f(x)}{g(x)} = \\lim_{x \\to a} \\frac{f\'(x)}{g\'(x)}' },
  { group: '高数', name: '极坐标二重积分', display: true, tex: '\\iint_D f(x,y)\\,dx\\,dy = \\int_{\\alpha}^{\\beta} d\\theta \\int_{r_1(\\theta)}^{r_2(\\theta)} f(r\\cos\\theta, r\\sin\\theta)\\,r\\,dr' },
  { group: '线代', name: '特征方程', display: false, tex: '|\\lambda E - A| = 0' },
  { group: '线代', name: '相似对角化', display: false, tex: 'P^{-1} A P = \\Lambda' },
  { group: '线代', name: '正交变换二次型', display: false, tex: 'Q^T A Q = \\Lambda,\\quad Q^{-1} = Q^T' },
  { group: '概率', name: '方差公式', display: false, tex: 'D(X) = E(X^2) - [E(X)]^2' },
  { group: '概率', name: '贝叶斯公式', display: true, tex: 'P(B_i \\mid A) = \\frac{P(B_i)P(A \\mid B_i)}{\\sum_{j=1}^{n} P(B_j)P(A \\mid B_j)}' },
  { group: '概率', name: '正态分布', display: false, tex: 'X \\sim N(\\mu, \\sigma^2)' },
  { group: '408', name: '主定理', display: false, tex: 'T(n) = aT\\left(\\frac{n}{b}\\right) + f(n)' },
  { group: '408', name: '平均访存时间', display: false, tex: 'T_{\\text{avg}} = h \\cdot t_c + (1-h)(t_c + t_m)' },
  { group: '408', name: '二叉树度关系', display: false, tex: 'n_0 = n_2 + 1' }
];

// ===================== 2. LaTeX 符号「中文俗称」词库 =====================
// 每条包含：{ tex, name(中文俗称), aliases(俗称/读音/英文/拼音提示), cat }
const MS_SYMBOL_CATALOG = [
  // ---- 运算关系 ----
  { cat: '运算关系', name: '约等于', aliases: '大约 约等 近似 approx', tex: '\\approx' },
  { cat: '运算关系', name: '不等于', aliases: '不等 != neq', tex: '\\neq' },
  { cat: '运算关系', name: '恒等于 / 同余', aliases: '三横线 恒等 定义 同余 equiv', tex: '\\equiv' },
  { cat: '运算关系', name: '等价无穷小 / 服从', aliases: '波浪线 相似 服从分布 sim', tex: '\\sim' },
  { cat: '运算关系', name: '渐近等于', aliases: '约等带横线 同阶 渐近 simeq', tex: '\\simeq' },
  { cat: '运算关系', name: '小于等于', aliases: '<= le leq 不大于', tex: '\\le' },
  { cat: '运算关系', name: '大于等于', aliases: '>= ge geq 不小于', tex: '\\ge' },
  { cat: '运算关系', name: '远小于 / 左移', aliases: '<< 远远小于 ll', tex: '\\ll' },
  { cat: '运算关系', name: '远大于 / 右移', aliases: '>> 远远大于 gg', tex: '\\gg' },
  { cat: '运算关系', name: '乘号 / 叉乘', aliases: '叉号 叉积 向量积 times', tex: '\\times' },
  { cat: '运算关系', name: '点乘 / 内积点', aliases: '小黑点 点积 cdot', tex: '\\cdot' },
  { cat: '运算关系', name: '除号', aliases: '除以 div', tex: '\\div' },
  { cat: '运算关系', name: '正负号', aliases: '加减 +- pm', tex: '\\pm' },
  { cat: '运算关系', name: '负正号', aliases: '减加 -+ mp', tex: '\\mp' },
  { cat: '运算关系', name: '推出 / 蕴含', aliases: '右双箭头 所以 推导出 Rightarrow implies', tex: '\\Rightarrow' },
  { cat: '运算关系', name: '等价 / 充要条件', aliases: '双向双箭头 当且仅当 iff Leftrightarrow', tex: '\\Leftrightarrow' },
  { cat: '运算关系', name: '趋近于 / 映射', aliases: '右箭头 趋向于 to rightarrow', tex: '\\to' },
  { cat: '运算关系', name: '双向箭头', aliases: '左到右 右到左 leftrightarrow', tex: '\\leftrightarrow' },
  { cat: '运算关系', name: '因为', aliases: '倒三角三点 because', tex: '\\because' },
  { cat: '运算关系', name: '所以', aliases: '正三角三点 therefore', tex: '\\therefore' },
  { cat: '运算关系', name: '比例 / 正比于', aliases: '无穷开口 成正比 propto', tex: '\\propto' },
  { cat: '运算关系', name: '星号卷积', aliases: '卷积 星乘 ast', tex: '\\ast' },

  // ---- 微积分 ----
  { cat: '微积分', name: '无穷大', aliases: '无限大 躺倒8 infty infinity', tex: '\\infty' },
  { cat: '微积分', name: '正无穷', aliases: '+无穷 +infty', tex: '+\\infty' },
  { cat: '微积分', name: '负无穷', aliases: '-无穷 -infty', tex: '-\\infty' },
  { cat: '微积分', name: '极限', aliases: '趋近极限 lim', tex: '\\lim_{x \\to 0}' },
  { cat: '微积分', name: '偏导符号', aliases: '偏微分 弯d partial', tex: '\\partial' },
  { cat: '微积分', name: '梯度 / 算子(倒三角)', aliases: '纳布拉 散度 旋度 哈密顿 nabla', tex: '\\nabla' },
  { cat: '微积分', name: '不定积分号', aliases: '积分 蛇形 int', tex: '\\int' },
  { cat: '微积分', name: '定积分', aliases: '带上下限积分 int_a^b', tex: '\\int_{a}^{b}' },
  { cat: '微积分', name: '二重积分', aliases: '面积分 双积分 iint', tex: '\\iint_{D}' },
  { cat: '微积分', name: '三重积分', aliases: '体积分 三积分 iiint', tex: '\\iiint_{\\Omega}' },
  { cat: '微积分', name: '环路 / 曲线积分', aliases: '闭环积分 带圈积分 oint', tex: '\\oint_{L}' },
  { cat: '微积分', name: '求和符号(大西格玛)', aliases: '连加 累加 sum', tex: '\\sum_{i=1}^{n}' },
  { cat: '微积分', name: '连乘符号(大派)', aliases: '求积 累乘 prod', tex: '\\prod_{i=1}^{n}' },
  { cat: '微积分', name: '微分正体 d', aliases: '积分微元 小间距 dx', tex: '\\,dx' },
  { cat: '微积分', name: '一阶导撇号', aliases: '一撇 导数 prime', tex: "f'(x)" },
  { cat: '微积分', name: '二阶导两撇', aliases: '两撇 二阶导', tex: "f''(x)" },
  { cat: '微积分', name: 'n 阶导数', aliases: '高阶导上标', tex: 'f^{(n)}(x)' },

  // ---- 线代向量 ----
  { cat: '线代向量', name: '矩阵转置', aliases: '右上角T 转置 T', tex: 'A^{T}' },
  { cat: '线代向量', name: '逆矩阵', aliases: '负一次方 求逆 -1', tex: 'A^{-1}' },
  { cat: '线代向量', name: '伴随矩阵', aliases: '右上角星号 A星', tex: 'A^{*}' },
  { cat: '线代向量', name: '向量箭头(顶箭头)', aliases: '头顶箭头 vec', tex: '\\vec{a}' },
  { cat: '线代向量', name: '粗体向量 / 矩阵', aliases: '加粗字母 mathbf', tex: '\\mathbf{x}' },
  { cat: '线代向量', name: '范数 / 模长(双竖线)', aliases: '向量长度 模 二范数 norm', tex: '\\|x\\|' },
  { cat: '线代向量', name: '内积(尖括号)', aliases: '点积尖括号 langle rangle', tex: '\\langle a, b \\rangle' },
  { cat: '线代向量', name: '垂直 / 正交', aliases: '直角 正交 垂线 perp', tex: '\\perp' },
  { cat: '线代向量', name: '平行', aliases: '双竖线 平行 parallel', tex: '\\parallel' },
  { cat: '线代向量', name: '横向省略号', aliases: '居中三个点 横点点点 cdots', tex: '\\cdots' },
  { cat: '线代向量', name: '底对齐省略号', aliases: '脚下三个点 ldots', tex: '\\ldots' },
  { cat: '线代向量', name: '竖向省略号', aliases: '竖着三个点 矩阵竖点 vdots', tex: '\\vdots' },
  { cat: '线代向量', name: '斜向省略号', aliases: '对角线三个点 主对角点 ddots', tex: '\\ddots' },
  { cat: '线代向量', name: '组合 / 二项式', aliases: 'C几几 组合数 binom', tex: '\\binom{n}{k}' },

  // ---- 希腊字母 ----
  { cat: '希腊字母', name: '阿尔法 (α)', aliases: 'alpha a 希腊字母', tex: '\\alpha' },
  { cat: '希腊字母', name: '贝塔 (β)', aliases: 'beta b 希腊字母', tex: '\\beta' },
  { cat: '希腊字母', name: '伽马 (γ)', aliases: 'gamma r 希腊字母', tex: '\\gamma' },
  { cat: '希腊字母', name: '大写伽马 (Γ)', aliases: 'Gamma 伽玛函数', tex: '\\Gamma' },
  { cat: '希腊字母', name: '德尔塔 (δ)', aliases: 'delta 小三角 增量 希腊字母', tex: '\\delta' },
  { cat: '希腊字母', name: '大写德尔塔 / 增量 (Δ)', aliases: 'Delta 判别式 变化量 三角形', tex: '\\Delta' },
  { cat: '希腊字母', name: '伊普西龙 / 任意小正数 (ε)', aliases: 'epsilon varepsilon 艾普西龙', tex: '\\varepsilon' },
  { cat: '希腊字母', name: '泽塔 (ζ)', aliases: 'zeta 希腊字母', tex: '\\zeta' },
  { cat: '希腊字母', name: '伊塔 (η)', aliases: 'eta 效率 学习率 希腊字母', tex: '\\eta' },
  { cat: '希腊字母', name: '西塔 / 角度 (θ)', aliases: 'theta 角度 参数 希腊字母', tex: '\\theta' },
  { cat: '希腊字母', name: '卡帕 (κ)', aliases: 'kappa 条件数 曲率', tex: '\\kappa' },
  { cat: '希腊字母', name: '拉姆达 / 特征值 (λ)', aliases: 'lambda 兰姆达 特征根 泊松参数', tex: '\\lambda' },
  { cat: '希腊字母', name: '大写拉姆达 / 对角阵 (Λ)', aliases: 'Lambda 对角矩阵', tex: '\\Lambda' },
  { cat: '希腊字母', name: '缪 / 均值 (μ)', aliases: 'mu 期望 均值 摩擦系数', tex: '\\mu' },
  { cat: '希腊字母', name: '纽 / 自由度 (ν)', aliases: 'nu 频率', tex: '\\nu' },
  { cat: '希腊字母', name: '克西 / 中值点 (ξ)', aliases: 'xi 柯西 拉格朗日中值点', tex: '\\xi' },
  { cat: '希腊字母', name: '派 / 圆周率 (π)', aliases: 'pi 3.14 概率分布', tex: '\\pi' },
  { cat: '希腊字母', name: '柔 / 相关系数 / 密度 (ρ)', aliases: 'rho 曲率半径 密度', tex: '\\rho' },
  { cat: '希腊字母', name: '西格玛 / 标准差 (σ)', aliases: 'sigma 标准差 方差开根', tex: '\\sigma' },
  { cat: '希腊字母', name: '大写西格玛 / 协方差阵 (Σ)', aliases: 'Sigma 积分区域 协方差矩阵', tex: '\\Sigma' },
  { cat: '希腊字母', name: '陶 (τ)', aliases: 'tau 时间常数', tex: '\\tau' },
  { cat: '希腊字母', name: '法伊 / 分布函数 (φ)', aliases: 'phi varphi 斐 黄金比例', tex: '\\varphi' },
  { cat: '希腊字母', name: '大写法伊 / 标准正态 (Φ)', aliases: 'Phi 大写斐 正态分布函数', tex: '\\Phi' },
  { cat: '希腊字母', name: '凯 / 卡方 (χ)', aliases: 'chi 卡方分布', tex: '\\chi' },
  { cat: '希腊字母', name: '普赛 (ψ)', aliases: 'psi 波函数', tex: '\\psi' },
  { cat: '希腊字母', name: '欧米伽 (ω)', aliases: 'omega 角速度 渐近紧界', tex: '\\omega' },
  { cat: '希腊字母', name: '大写欧米伽 / 样本空间 (Ω)', aliases: 'Omega 欧姆 大O下界 积分域', tex: '\\Omega' },

  // ---- 集合概率408 ----
  { cat: '集合概率408', name: '属于', aliases: '元素在集合内 in', tex: '\\in' },
  { cat: '集合概率408', name: '不属于', aliases: '不在集合内 notin', tex: '\\notin' },
  { cat: '集合概率408', name: '子集 / 包含于', aliases: '真子集 subseteq subset', tex: '\\subseteq' },
  { cat: '集合概率408', name: '并集', aliases: '集合相加 开口向上 cup', tex: '\\cup' },
  { cat: '集合概率408', name: '交集', aliases: '公共部分 开口向下 cap', tex: '\\cap' },
  { cat: '集合概率408', name: '空集', aliases: '圆圈斜杠 varnothing emptyset', tex: '\\varnothing' },
  { cat: '集合概率408', name: '差集 / 剔除', aliases: '反斜杠 集合减 setminus', tex: '\\setminus' },
  { cat: '集合概率408', name: '任意(倒A)', aliases: '对所有 全称量词 forall', tex: '\\forall' },
  { cat: '集合概率408', name: '存在(反E)', aliases: '至少有一个 存在量词 exists', tex: '\\exists' },
  { cat: '集合概率408', name: '逻辑与 (∧)', aliases: '且 尖角向上 wedge land', tex: '\\land' },
  { cat: '集合概率408', name: '逻辑或 (∨)', aliases: '或 尖角向下 vee lor', tex: '\\lor' },
  { cat: '集合概率408', name: '逻辑非 (¬)', aliases: '取反 拐角 neg lnot', tex: '\\neg' },
  { cat: '集合概率408', name: '异或 (⊕)', aliases: '圆圈加 直和 XOR oplus', tex: '\\oplus' },
  { cat: '集合概率408', name: '同圆乘 / 克罗内克积 (⊗)', aliases: '圆圈乘 张量积 otimes', tex: '\\otimes' },
  { cat: '集合概率408', name: '条件竖线', aliases: '条件概率 P(A|B) mid', tex: '\\mid' },
  { cat: '集合概率408', name: '向上取整', aliases: '天花板 ceil lceil rceil', tex: '\\lceil x \\rceil' },
  { cat: '集合概率408', name: '向下取整', aliases: '地板 floor lfloor rfloor', tex: '\\lfloor x \\rfloor' },
  { cat: '集合概率408', name: '实数集 ℝ', aliases: '空心R mathbb R', tex: '\\mathbb{R}' },
  { cat: '集合概率408', name: '整数集 ℤ', aliases: '空心Z mathbb Z', tex: '\\mathbb{Z}' },
  { cat: '集合概率408', name: '自然数集 ℕ', aliases: '空心N mathbb N', tex: '\\mathbb{N}' },
  { cat: '集合概率408', name: '度数 (°)', aliases: '角度 圆圈上标 circ', tex: '^{\\circ}' },

  // ---- 修饰括号 ----
  { cat: '修饰括号', name: '平均数(头上加一横 / 拔)', aliases: 'x拔 均值 bar', tex: '\\bar{x}' },
  { cat: '修饰括号', name: '长上划线 / 共轭 / 非', aliases: '多字母头上横线 补集 取反 overline', tex: '\\overline{AB}' },
  { cat: '修饰括号', name: '估计值 / 单位向量(戴帽子)', aliases: '尖帽 x帽 hat', tex: '\\hat{x}' },
  { cat: '修饰括号', name: '波浪帽(近似/等价类)', aliases: '头上波浪 tilde', tex: '\\tilde{x}' },
  { cat: '修饰括号', name: '牛顿一阶导(头上一点)', aliases: 'x点 dot', tex: '\\dot{x}' },
  { cat: '修饰括号', name: '牛顿二阶导(头上两点)', aliases: 'x两点 ddot', tex: '\\ddot{x}' },
  { cat: '修饰括号', name: '上方花括号注释', aliases: '头顶大括号 overbrace', tex: '\\overbrace{a+b}^{n}' },
  { cat: '修饰括号', name: '下方花括号注释', aliases: '脚下大括号 underbrace', tex: '\\underbrace{a+b}_{n}' },
  { cat: '修饰括号', name: '自适应大括号', aliases: '大圆括号 left right', tex: '\\left( \\frac{a}{b} \\right)' },
  { cat: '修饰括号', name: '竖线代入求值', aliases: '牛顿莱布尼茨求值上下限 right|', tex: '\\left. F(x) \\right|_{a}^{b}' },
  { cat: '修饰括号', name: '公式内插中文/正体字', aliases: '正体英文 中文 text', tex: '\\text{中文}' }
];

// ===================== 3. 工具函数：检测光标是否处于公式内 =====================
function findFormulaBoundsAroundCursor(text, pos) {
  const s = String(text || '');
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\\' && s[i + 1] === '$') {
      i += 2;
      continue;
    }
    if (s[i] === '$' && s[i + 1] === '$') {
      const close = s.indexOf('$$', i + 2);
      if (close !== -1) {
        tokens.push({ start: i, end: close + 2, innerStart: i + 2, innerEnd: close, display: true });
        i = close + 2;
        continue;
      }
    } else if (s[i] === '$') {
      const nl = s.indexOf('\n', i + 1);
      const close = s.indexOf('$', i + 1);
      if (close !== -1 && (nl === -1 || close < nl)) {
        tokens.push({ start: i, end: close + 1, innerStart: i + 1, innerEnd: close, display: false });
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  return tokens.find(t => pos >= t.start && pos <= t.end) || null;
}

function getRecentLatexSymbols() {
  try {
    const raw = localStorage.getItem(LS_RECENT_LATEX_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function pushRecentLatexSymbol(tex) {
  try {
    const list = getRecentLatexSymbols().filter(x => x !== tex);
    list.unshift(tex);
    localStorage.setItem(LS_RECENT_LATEX_KEY, JSON.stringify(list.slice(0, MS_MAX_RECENT)));
  } catch {}
}

function getTargetPreviewCallback(taId) {
  if (taId === 'rec-note' && typeof recNoteLivePreview === 'function') return recNoteLivePreview;
  if (taId === 'pol-analysis' && typeof polNoteLivePreview === 'function') return polNoteLivePreview;
  return null;
}

// ===================== 4. 打开 / 关闭 / Tab 切换 =====================
function openMathStudio(taId = 'rec-note', initialTab = 'formula') {
  const ta = document.getElementById(taId);
  mathStudioState.taId = taId;
  mathStudioState.cursorStart = ta ? ta.selectionStart : 0;
  mathStudioState.cursorEnd = ta ? ta.selectionEnd : 0;
  mathStudioState.replaceRange = null;
  mathStudioState.symInsertTarget = initialTab === 'symbols' ? 'card' : 'formula';

  const texEl = document.getElementById('ms-tex-input');
  let prefill = '';
  let display = false;

  if (ta) {
    const hit = findFormulaBoundsAroundCursor(ta.value, ta.selectionStart);
    if (hit && ta.selectionStart === ta.selectionEnd) {
      prefill = ta.value.slice(hit.innerStart, hit.innerEnd).trim();
      display = hit.display;
      mathStudioState.replaceRange = { start: hit.start, end: hit.end };
    } else if (ta.selectionStart !== ta.selectionEnd) {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
      if (/^\$\$[\s\S]+\$\$$/.test(sel)) {
        prefill = sel.slice(2, -2).trim();
        display = true;
        mathStudioState.replaceRange = { start: ta.selectionStart, end: ta.selectionEnd };
      } else if (/^\$[^\n]+\$$/.test(sel)) {
        prefill = sel.slice(1, -1).trim();
        display = false;
        mathStudioState.replaceRange = { start: ta.selectionStart, end: ta.selectionEnd };
      } else if (sel.length <= 160 && !sel.includes('\n')) {
        prefill = sel;
        mathStudioState.replaceRange = { start: ta.selectionStart, end: ta.selectionEnd };
      }
    }
  }

  mathStudioState.displayMode = display;
  if (texEl) texEl.value = prefill;

  renderMathStudioSnippets();
  renderMathStudioTemplates();
  renderMathStudioMatrixGrid();
  renderMathStudioSymbols();
  updateMathStudioReplaceBanner();
  updateMathStudioDisplayButtons();
  updateMathStudioSymTargetUI();
  refreshMathStudioFormulaPreview();
  refreshMathStudioMatrixPreview();

  const modal = document.getElementById('mathStudioModal');
  if (modal) modal.classList.add('open');
  mathStudioSwitchTab(initialTab);
}

function closeMathStudio() {
  const modal = document.getElementById('mathStudioModal');
  if (modal) modal.classList.remove('open');
  const ta = document.getElementById(mathStudioState.taId);
  if (ta) {
    setTimeout(() => ta.focus(), 40);
  }
}

function clearMathStudioReplaceMode() {
  mathStudioState.replaceRange = null;
  updateMathStudioReplaceBanner();
}

function updateMathStudioReplaceBanner() {
  const banner = document.getElementById('ms-replace-banner');
  if (!banner) return;
  banner.classList.toggle('hidden', !mathStudioState.replaceRange);
}

function mathStudioSwitchTab(tab) {
  const allowed = ['formula', 'matrix', 'symbols'];
  const next = allowed.includes(tab) ? tab : 'formula';
  mathStudioState.tab = next;

  allowed.forEach(t => {
    const btn = document.getElementById(`ms-tab-btn-${t}`);
    const pane = document.getElementById(`ms-pane-${t}`);
    if (btn) btn.classList.toggle('ms-tab-active', t === next);
    if (pane) pane.classList.toggle('hidden', t !== next);
  });

  if (next === 'formula') {
    refreshMathStudioFormulaPreview();
    setTimeout(() => document.getElementById('ms-tex-input')?.focus(), 40);
  } else if (next === 'matrix') {
    refreshMathStudioMatrixPreview();
    setTimeout(() => document.querySelector('#ms-matrix-grid input')?.focus(), 40);
  } else if (next === 'symbols') {
    renderMathStudioSymbols();
    setTimeout(() => document.getElementById('ms-sym-search')?.focus(), 40);
  }
}

// ===================== 5. Tab 1: 公式编辑器 =====================
function setMathStudioDisplayMode(isDisplay) {
  mathStudioState.displayMode = Boolean(isDisplay);
  updateMathStudioDisplayButtons();
  refreshMathStudioFormulaPreview();
}

function updateMathStudioDisplayButtons() {
  const inlineBtn = document.getElementById('ms-mode-inline');
  const blockBtn = document.getElementById('ms-mode-block');
  if (inlineBtn) inlineBtn.classList.toggle('md-tab-active', !mathStudioState.displayMode);
  if (blockBtn) blockBtn.classList.toggle('md-tab-active', mathStudioState.displayMode);
}

function renderMathStudioSnippets() {
  const box = document.getElementById('ms-formula-snippets');
  if (!box || box.dataset.built) return;
  box.dataset.built = '1';
  box.innerHTML = MS_FORMULA_SNIPPETS.map((s, idx) => `
    <button type="button" onclick="insertMathSnippet(${idx})" class="md-tool text-xs" title="${escapeHtml(s.tex)}">
      ${escapeHtml(s.label)}
    </button>
  `).join('');
}

function renderMathStudioTemplates() {
  const box = document.getElementById('ms-formula-templates');
  if (!box || box.dataset.built) return;
  box.dataset.built = '1';
  const groupStyles = {
    '高数': 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
    '线代': 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
    '概率': 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
    '408': 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
  };
  box.innerHTML = MS_EXAM_TEMPLATES.map((tpl, idx) => `
    <button type="button" onclick="applyMathTemplate(${idx})"
      class="btn-tactile px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${groupStyles[tpl.group] || 'bg-slate-100 text-slate-700 border-slate-200'}"
      title="${escapeHtml(tpl.tex)}">
      <span class="opacity-70 mr-1">${escapeHtml(tpl.group)}·</span>${escapeHtml(tpl.name)}
    </button>
  `).join('');
}

function insertIntoFormulaInput(tex, selectToken = '') {
  const ta = document.getElementById('ms-tex-input');
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd;
  let selStart = s + tex.length;
  let selEnd = selStart;
  if (selectToken) {
    const braceMatch = tex.indexOf(`{${selectToken}}`);
    const bracketMatch = tex.indexOf(`[${selectToken}]`);
    if (braceMatch !== -1) {
      selStart = s + braceMatch + 1;
      selEnd = selStart + selectToken.length;
    } else if (bracketMatch !== -1) {
      selStart = s + bracketMatch + 1;
      selEnd = selStart + selectToken.length;
    } else {
      const offset = tex.indexOf(selectToken);
      if (offset !== -1) {
        selStart = s + offset;
        selEnd = selStart + selectToken.length;
      }
    }
  }
  mdEditorReplaceRange(ta, s, e, tex, selStart, selEnd, refreshMathStudioFormulaPreview);
}

function insertMathSnippet(idx) {
  const s = MS_FORMULA_SNIPPETS[idx];
  if (!s) return;
  if (s.display) setMathStudioDisplayMode(true);
  insertIntoFormulaInput(s.tex, s.select || '');
}

function applyMathTemplate(idx) {
  const tpl = MS_EXAM_TEMPLATES[idx];
  if (!tpl) return;
  const ta = document.getElementById('ms-tex-input');
  if (!ta) return;
  setMathStudioDisplayMode(Boolean(tpl.display));
  const cur = ta.value.trim();
  const isDefaultSnippetOrTpl =
    !cur ||
    MS_FORMULA_SNIPPETS.some(s => s.tex.trim() === cur) ||
    MS_EXAM_TEMPLATES.some(t => t.tex.trim() === cur);
  if (isDefaultSnippetOrTpl) {
    mdEditorReplaceRange(ta, 0, ta.value.length, tpl.tex, 0, tpl.tex.length, refreshMathStudioFormulaPreview);
  } else {
    insertIntoFormulaInput((ta.value.slice(0, ta.selectionStart).endsWith('\n') ? '' : ' ') + tpl.tex);
  }
}

function clearMathStudioFormula() {
  const ta = document.getElementById('ms-tex-input');
  if (!ta) return;
  ta.value = '';
  ta.focus();
  refreshMathStudioFormulaPreview();
}

function copyMathStudioFormula() {
  const ta = document.getElementById('ms-tex-input');
  const raw = (ta ? ta.value : '').trim();
  if (!raw) {
    showToast('当前公式为空', 'warning');
    return;
  }
  const wrapped = mathStudioState.displayMode ? `$$\n${raw}\n$$` : `$${raw}$`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(wrapped).then(() => showToast('已复制带定界符的公式源码', 'success'));
  } else {
    showToast('当前环境不支持剪贴板写入', 'warning');
  }
}

function refreshMathStudioFormulaPreview() {
  const ta = document.getElementById('ms-tex-input');
  const pv = document.getElementById('ms-formula-preview');
  const errEl = document.getElementById('ms-formula-status');
  if (!ta || !pv) return;
  const res = renderTexToEl(pv, ta.value, mathStudioState.displayMode);
  if (errEl) {
    if (res.empty) {
      errEl.textContent = mathStudioState.displayMode ? '独立居中块 $$...$$' : '行内公式 $...$';
      errEl.className = 'text-[11px] font-medium text-slate-400';
    } else if (res.ok) {
      errEl.textContent = '✓ 公式渲染正常';
      errEl.className = 'text-[11px] font-semibold text-emerald-600';
    } else {
      errEl.textContent = '⚠️ 公式尚未写完或存在括号/命令不匹配';
      errEl.className = 'text-[11px] font-semibold text-amber-600';
    }
  }
}

function handleMathInputKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    applyMathStudioFormulaToCard();
    return;
  }
  if (e.key === 'Tab') {
    const ta = e.target;
    const pos = ta.selectionEnd;
    const nextBrace = ta.value.indexOf('{}', pos);
    if (nextBrace !== -1) {
      e.preventDefault();
      ta.setSelectionRange(nextBrace + 1, nextBrace + 1);
      return;
    }
  }
}

function insertWrappedFormulaIntoCard(rawTex, forceDisplayMode) {
  const ta = document.getElementById(mathStudioState.taId);
  if (!ta) return;
  const clean = String(rawTex || '').trim();
  if (!clean) {
    showToast('请先输入公式内容', 'warning');
    return;
  }
  const wrapped = forceDisplayMode ? `\n$$\n${clean}\n$$\n` : `$${clean}$`;
  const onAfter = getTargetPreviewCallback(mathStudioState.taId);

  if (mathStudioState.replaceRange) {
    const { start, end } = mathStudioState.replaceRange;
    const replaceText = forceDisplayMode ? `$$\n${clean}\n$$` : `$${clean}$`;
    closeMathStudio();
    mdEditorReplaceRange(ta, start, end, replaceText, start + replaceText.length, start + replaceText.length, onAfter);
    showToast('已更新原位置公式', 'success');
    return;
  }

  const s = mathStudioState.cursorStart;
  const e = mathStudioState.cursorEnd;
  let finalText = wrapped;
  if (forceDisplayMode) {
    const prefixNeedsNl = s > 0 && ta.value[s - 1] !== '\n';
    const suffixNeedsNl = e < ta.value.length && ta.value[e] !== '\n';
    finalText = `${prefixNeedsNl ? '\n' : ''}$$\n${clean}\n$$${suffixNeedsNl ? '\n' : ''}`;
  }
  closeMathStudio();
  mdEditorReplaceRange(ta, s, e, finalText, s + finalText.length, s + finalText.length, onAfter);
  showToast('已插入公式到卡片备注', 'success');
}

function applyMathStudioFormulaToCard() {
  const ta = document.getElementById('ms-tex-input');
  insertWrappedFormulaIntoCard(ta ? ta.value : '', mathStudioState.displayMode);
}

// ===================== 6. Tab 2: 可视化矩阵生成器 =====================
function ensureMatrixDimensions(rows, cols) {
  const m = mathStudioState.matrix;
  const r = Math.min(MS_MAX_DIM, Math.max(1, rows));
  const c = m.type === 'cases' ? 2 : Math.min(MS_MAX_DIM, Math.max(1, cols));
  const next = [];
  for (let i = 0; i < r; i++) {
    const row = [];
    for (let j = 0; j < c; j++) {
      row.push((m.cells[i] && m.cells[i][j] !== undefined) ? m.cells[i][j] : '0');
    }
    next.push(row);
  }
  m.rows = r;
  m.cols = c;
  m.cells = next;
  if (m.augCol < 1) m.augCol = 1;
  if (m.augCol >= c) m.augCol = Math.max(1, c - 1);
}

function setMatrixType(type) {
  const m = mathStudioState.matrix;
  m.type = type;
  if (type === 'cases') {
    if (m.cols !== 2) {
      const next = [];
      for (let i = 0; i < m.rows; i++) {
        next.push([
          (m.cells[i] && m.cells[i][0]) || 'x',
          (m.cells[i] && m.cells[i][1]) || 'x \\ge 0'
        ]);
      }
      m.cols = 2;
      m.cells = next;
    }
  } else {
    ensureMatrixDimensions(m.rows, m.cols);
    if (type === 'augmented' && m.cols < 2) {
      ensureMatrixDimensions(m.rows, 3);
      m.augCol = 2;
    } else if (type === 'augmented') {
      m.augCol = Math.max(1, m.cols - 1);
    }
  }
  renderMathStudioMatrixGrid();
  refreshMathStudioMatrixPreview();
}

function stepMatrixSize(deltaR, deltaC) {
  const m = mathStudioState.matrix;
  ensureMatrixDimensions(m.rows + deltaR, m.cols + deltaC);
  renderMathStudioMatrixGrid();
  refreshMathStudioMatrixPreview();
}

function stepAugCol(delta) {
  const m = mathStudioState.matrix;
  if (m.cols <= 1) return;
  m.augCol = Math.min(m.cols - 1, Math.max(1, m.augCol + delta));
  renderMathStudioMatrixGrid();
  refreshMathStudioMatrixPreview();
}

function fillMatrixPreset(kind) {
  const m = mathStudioState.matrix;
  if (m.type === 'cases') {
    m.rows = 2;
    m.cols = 2;
    m.cells = kind === 'clear'
      ? [['', ''], ['', '']]
      : [['x', 'x \\ge 0'], ['-x', 'x < 0']];
    renderMathStudioMatrixGrid();
    refreshMathStudioMatrixPreview();
    return;
  }
  if (kind === 'transpose') {
    const next = [];
    for (let j = 0; j < m.cols; j++) {
      const row = [];
      for (let i = 0; i < m.rows; i++) row.push(m.cells[i]?.[j] || '0');
      next.push(row);
    }
    const oldR = m.rows;
    m.rows = m.cols;
    m.cols = oldR;
    m.cells = next;
    renderMathStudioMatrixGrid();
    refreshMathStudioMatrixPreview();
    return;
  }
  for (let i = 0; i < m.rows; i++) {
    for (let j = 0; j < m.cols; j++) {
      if (kind === 'identity') m.cells[i][j] = i === j ? '1' : '0';
      else if (kind === 'diag') m.cells[i][j] = i === j ? `\\lambda_{${i + 1}}` : '0';
      else if (kind === 'zero') m.cells[i][j] = '0';
      else if (kind === 'indexed') m.cells[i][j] = `a_{${i + 1}${j + 1}}`;
      else if (kind === 'dots') {
        const lastR = m.rows - 1, lastC = m.cols - 1;
        const midR = Math.floor(m.rows / 2), midC = Math.floor(m.cols / 2);
        if (m.rows >= 3 && m.cols >= 3) {
          if (i === midR && j === midC) m.cells[i][j] = '\\ddots';
          else if (i === midR) m.cells[i][j] = '\\vdots';
          else if (j === midC) m.cells[i][j] = '\\cdots';
          else {
            const ri = i > midR ? 'n' : String(i + 1);
            const cj = j > midC ? 'n' : String(j + 1);
            m.cells[i][j] = `a_{${ri}${cj}}`;
          }
        } else {
          m.cells[i][j] = (i === lastR && j === lastC) ? 'a_{mn}' : `a_{${i + 1}${j + 1}}`;
        }
      } else if (kind === 'clear') m.cells[i][j] = '';
    }
  }
  renderMathStudioMatrixGrid();
  refreshMathStudioMatrixPreview();
}

function parseQuickTextToMatrix() {
  const input = document.getElementById('ms-matrix-paste');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) {
    showToast('请先粘贴或输入几行数字（空格或逗号分隔）', 'warning');
    return;
  }
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  const parsed = lines.slice(0, MS_MAX_DIM).map(l =>
    l.split(/[\s,，;；\t]+/).map(x => x.trim()).filter(Boolean).slice(0, MS_MAX_DIM)
  );
  const maxC = Math.max(1, ...parsed.map(r => r.length));
  const m = mathStudioState.matrix;
  if (m.type === 'cases' && maxC > 2) m.type = 'pmatrix';
  m.rows = parsed.length;
  m.cols = m.type === 'cases' ? 2 : Math.min(MS_MAX_DIM, maxC);
  m.cells = Array.from({ length: m.rows }, (_, i) =>
    Array.from({ length: m.cols }, (_, j) => (parsed[i] && parsed[i][j]) || '0')
  );
  if (m.augCol >= m.cols) m.augCol = Math.max(1, m.cols - 1);
  renderMathStudioMatrixGrid();
  refreshMathStudioMatrixPreview();
  showToast(`已生成 ${m.rows}×${m.cols} 矩阵格子`, 'success');
}

function buildMatrixLatex() {
  const m = mathStudioState.matrix;
  const rowStr = (r) => m.cells[r].map(v => (String(v ?? '').trim() || '0')).join(' & ');
  const body = Array.from({ length: m.rows }, (_, i) => '  ' + rowStr(i)).join(' \\\\\n');

  if (m.type === 'cases') {
    const caseBody = Array.from({ length: m.rows }, (_, i) => {
      const left = String(m.cells[i]?.[0] ?? '').trim() || '0';
      const right = String(m.cells[i]?.[1] ?? '').trim();
      return right ? `  ${left}, & ${right}` : `  ${left}`;
    }).join(' \\\\\n');
    return `\\begin{cases}\n${caseBody}\n\\end{cases}`;
  }
  if (m.type === 'augmented') {
    const leftCols = 'c'.repeat(Math.max(1, m.augCol));
    const rightCols = 'c'.repeat(Math.max(1, m.cols - m.augCol));
    return `\\left(\\begin{array}{${leftCols}|${rightCols}}\n${body}\n\\end{array}\\right)`;
  }
  const env = ['pmatrix', 'bmatrix', 'vmatrix', 'matrix'].includes(m.type) ? m.type : 'pmatrix';
  return `\\begin{${env}}\n${body}\n\\end{${env}}`;
}

function renderMathStudioMatrixGrid() {
  const m = mathStudioState.matrix;
  const grid = document.getElementById('ms-matrix-grid');
  const dimLabel = document.getElementById('ms-matrix-dim');
  const augCtrl = document.getElementById('ms-aug-col-ctrl');
  const augVal = document.getElementById('ms-aug-col-val');
  const colStepper = document.getElementById('ms-col-stepper');

  if (dimLabel) dimLabel.textContent = `${m.rows} × ${m.cols}`;
  if (colStepper) colStepper.classList.toggle('opacity-40', m.type === 'cases');
  if (augCtrl) augCtrl.classList.toggle('hidden', m.type !== 'augmented');
  if (augVal) augVal.textContent = `第 ${m.augCol} 列后`;

  document.querySelectorAll('[data-ms-mtype]').forEach(btn => {
    btn.classList.toggle('md-tab-active', btn.dataset.msMtype === m.type);
  });

  if (!grid) return;
  grid.style.gridTemplateColumns = `repeat(${m.cols}, minmax(${m.type === 'cases' ? '8rem' : '3.6rem'}, 1fr))`;
  const html = [];
  for (let i = 0; i < m.rows; i++) {
    for (let j = 0; j < m.cols; j++) {
      const val = m.cells[i]?.[j] ?? '';
      const isAugBoundary = m.type === 'augmented' && j === m.augCol - 1;
      const ph = m.type === 'cases' ? (j === 0 ? '表达式' : '条件') : `a${i + 1}${j + 1}`;
      html.push(
        `<input type="text" data-r="${i}" data-c="${j}" value="${escapeHtml(val)}" placeholder="${ph}"` +
        ` oninput="onMatrixCellInput(${i}, ${j}, this.value)"` +
        ` onkeydown="onMatrixCellKeydown(event, ${i}, ${j})"` +
        ` onfocus="this.select()"` +
        ` class="ms-matrix-cell ${isAugBoundary ? 'ms-matrix-aug-left' : ''}" />`
      );
    }
  }
  grid.innerHTML = html.join('');
}

function onMatrixCellInput(r, c, value) {
  if (!mathStudioState.matrix.cells[r]) return;
  mathStudioState.matrix.cells[r][c] = value;
  refreshMathStudioMatrixPreview();
}

function onMatrixCellKeydown(e, r, c) {
  const m = mathStudioState.matrix;
  const focusCell = (nr, nc) => {
    const el = document.querySelector(`#ms-matrix-grid input[data-r="${nr}"][data-c="${nc}"]`);
    if (el) { el.focus(); el.select(); }
  };
  if (e.key === 'Enter') {
    e.preventDefault();
    if (r + 1 < m.rows) focusCell(r + 1, c);
    else if (c + 1 < m.cols) focusCell(0, c + 1);
    else focusCell(0, 0);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (r + 1 < m.rows) focusCell(r + 1, c);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (r - 1 >= 0) focusCell(r - 1, c);
  } else if (e.key === 'ArrowLeft' && e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
    if (c - 1 >= 0) { e.preventDefault(); focusCell(r, c - 1); }
  } else if (e.key === 'ArrowRight' && e.target.selectionStart === e.target.value.length) {
    if (c + 1 < m.cols) { e.preventDefault(); focusCell(r, c + 1); }
  }
}

function refreshMathStudioMatrixPreview() {
  const pv = document.getElementById('ms-matrix-preview');
  const codeEl = document.getElementById('ms-matrix-code');
  const tex = buildMatrixLatex();
  if (pv) renderTexToEl(pv, tex, true);
  if (codeEl) codeEl.textContent = tex;
}

function sendMatrixToFormulaEditor() {
  const tex = buildMatrixLatex();
  mathStudioSwitchTab('formula');
  setMathStudioDisplayMode(true);
  insertIntoFormulaInput(tex);
  showToast('已将矩阵带入公式编辑器，可继续拼接前后式子', 'info');
}

function insertMatrixToCard() {
  const tex = buildMatrixLatex();
  insertWrappedFormulaIntoCard(tex, true);
}

// ===================== 7. Tab 3: LaTeX 符号「中文俗称」速查表 =====================
function setMathStudioSymTarget(mode) {
  mathStudioState.symInsertTarget = mode === 'formula' ? 'formula' : 'card';
  updateMathStudioSymTargetUI();
}

function updateMathStudioSymTargetUI() {
  const cardBtn = document.getElementById('ms-sym-target-card');
  const formBtn = document.getElementById('ms-sym-target-formula');
  const bar = document.getElementById('ms-sym-formula-bar');
  const isFormula = mathStudioState.symInsertTarget === 'formula';
  if (cardBtn) cardBtn.classList.toggle('md-tab-active', !isFormula);
  if (formBtn) formBtn.classList.toggle('md-tab-active', isFormula);
  if (bar) bar.classList.toggle('hidden', !isFormula);
  if (isFormula) {
    const pv = document.getElementById('ms-sym-mini-preview');
    const ta = document.getElementById('ms-tex-input');
    if (pv && ta) renderTexToEl(pv, ta.value, false);
  }
}

function setMathStudioSymCat(cat) {
  mathStudioState.symCat = cat;
  renderMathStudioSymbols();
}

function onMathStudioSymSearch(val) {
  mathStudioState.symQuery = String(val || '').trim().toLowerCase();
  renderMathStudioSymbols();
}

function renderMathStudioSymbols() {
  const catsBox = document.getElementById('ms-sym-cats');
  const grid = document.getElementById('ms-sym-grid');
  if (!grid) return;

  const recent = getRecentLatexSymbols();
  const cats = [
    { key: 'all', label: '全部' },
    { key: 'recent', label: `⭐ 最近 (${recent.length})` },
    { key: '运算关系', label: '运算关系' },
    { key: '微积分', label: '微积分' },
    { key: '线代向量', label: '线代向量' },
    { key: '希腊字母', label: '希腊字母' },
    { key: '集合概率408', label: '集合概率/408' },
    { key: '修饰括号', label: '修饰括号' }
  ];

  if (catsBox) {
    catsBox.innerHTML = cats.map(c => `
      <button type="button" onclick="setMathStudioSymCat('${c.key}')"
        class="btn-tactile px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${mathStudioState.symCat === c.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}">
        ${escapeHtml(c.label)}
      </button>
    `).join('');
  }

  const q = mathStudioState.symQuery;
  let items = MS_SYMBOL_CATALOG.map((item, idx) => ({ ...item, idx }));

  if (mathStudioState.symCat === 'recent') {
    const order = new Map(recent.map((tex, i) => [tex, i]));
    items = items.filter(it => order.has(it.tex)).sort((a, b) => order.get(a.tex) - order.get(b.tex));
  } else if (mathStudioState.symCat !== 'all') {
    items = items.filter(it => it.cat === mathStudioState.symCat);
  }

  if (q) {
    items = items.filter(it =>
      it.name.toLowerCase().includes(q) ||
      it.aliases.toLowerCase().includes(q) ||
      it.tex.toLowerCase().includes(q) ||
      it.cat.toLowerCase().includes(q)
    );
  }

  if (!items.length) {
    grid.innerHTML = `
      <div class="col-span-full py-10 text-center text-sm text-slate-400">
        没有找到匹配「${escapeHtml(q)}」的符号，试试搜：约等于 / 阿尔法 / 偏导 / 属于 / 拔 / 异或
      </div>`;
    return;
  }

  grid.innerHTML = items.map(it => `
    <button type="button" onclick="pickMathSymbol(${it.idx})" class="ms-sym-card group text-left">
      <div class="ms-sym-glyph" data-sym-tex="${escapeHtml(it.tex)}"></div>
      <div class="min-w-0 flex-1">
        <div class="text-xs font-bold text-slate-800 group-hover:text-blue-700 truncate">${escapeHtml(it.name)}</div>
        <div class="text-[11px] text-slate-400 truncate mt-0.5">${escapeHtml(it.aliases)}</div>
        <code class="inline-block mt-1 px-1.5 py-0.5 rounded bg-slate-100 text-[11px] font-mono text-indigo-700 group-hover:bg-blue-50">${escapeHtml(it.tex)}</code>
      </div>
    </button>
  `).join('');

  grid.querySelectorAll('.ms-sym-glyph').forEach(el => {
    renderTexToEl(el, el.dataset.symTex || '', false);
  });
}

function pickMathSymbol(idx) {
  const item = MS_SYMBOL_CATALOG[idx];
  if (!item) return;
  pushRecentLatexSymbol(item.tex);

  if (mathStudioState.symInsertTarget === 'formula') {
    const ta = document.getElementById('ms-tex-input');
    if (ta) {
      const s = ta.selectionStart, e = ta.selectionEnd;
      const prefix = s > 0 && /[a-zA-Z0-9]$/.test(ta.value.slice(0, s)) && /^\\[a-zA-Z]/.test(item.tex) ? ' ' : '';
      ta.value = ta.value.slice(0, s) + prefix + item.tex + ' ' + ta.value.slice(e);
      const nextPos = s + prefix.length + item.tex.length + 1;
      ta.setSelectionRange(nextPos, nextPos);
      refreshMathStudioFormulaPreview();
      const mini = document.getElementById('ms-sym-mini-preview');
      if (mini) renderTexToEl(mini, ta.value, false);
      showToast(`已拼接「${item.name}」到公式框`, 'success');
    }
    return;
  }

  const cardTa = document.getElementById(mathStudioState.taId);
  if (!cardTa) return;
  const s = mathStudioState.cursorStart;
  const e = mathStudioState.cursorEnd;
  const insideFormula = Boolean(findFormulaBoundsAroundCursor(cardTa.value, s));
  const textToInsert = insideFormula ? item.tex : `$${item.tex}$`;
  const onAfter = getTargetPreviewCallback(mathStudioState.taId);
  closeMathStudio();
  mdEditorReplaceRange(cardTa, s, e, textToInsert, s + textToInsert.length, s + textToInsert.length, onAfter);
  showToast(`已插入「${item.name}」(${textToInsert})`, 'success');
}
