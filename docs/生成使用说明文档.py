# -*- coding: utf-8 -*-
"""生成《JHYP 智能工作台 使用说明》Word 文档。"""

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

# 中文字体一律使用 Word / WPS 通用的标准字体名（宋体、黑体）：
# 它们在各系统上都有稳定的字体替换映射，缺失时也不会丢字；
# 而“微软雅黑”“苹方”这类字体名在缺少该字体的机器上会导致中文整段不显示。
CJK_BODY = "宋体"
CJK_HEAD = "黑体"
WEST_BODY = "Times New Roman"
WEST_HEAD = "Arial"
ACCENT = RGBColor(0x1F, 0x4E, 0x79)
OUT = "JHYP智能工作台-使用说明.docx"

doc = Document()

# 页面设置
for section in doc.sections:
    section.top_margin = Pt(56)
    section.bottom_margin = Pt(56)
    section.left_margin = Pt(64)
    section.right_margin = Pt(64)


def set_font(style, size, bold=False, color=None, cjk=CJK_BODY, west=WEST_BODY):
    style.font.name = west
    style.font.size = Pt(size)
    style.font.bold = bold
    if color is not None:
        style.font.color.rgb = color
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = rpr.makeelement(qn("w:rFonts"), {})
        rpr.append(rfonts)
    rfonts.set(qn("w:ascii"), west)
    rfonts.set(qn("w:hAnsi"), west)
    rfonts.set(qn("w:eastAsia"), cjk)


normal = doc.styles["Normal"]
set_font(normal, 10.5)
normal.paragraph_format.space_after = Pt(3)
normal.paragraph_format.line_spacing = 1.2

for name, size in (("Heading 1", 14), ("Heading 2", 12), ("Heading 3", 11)):
    st = doc.styles[name]
    set_font(st, size, bold=True, color=ACCENT, cjk=CJK_HEAD, west=WEST_HEAD)
    st.paragraph_format.space_before = Pt(10 if name == "Heading 1" else 7)
    st.paragraph_format.space_after = Pt(4)
    st.paragraph_format.line_spacing = 1.2

for name in ("List Bullet", "List Number"):
    try:
        set_font(doc.styles[name], 10.5)
        doc.styles[name].paragraph_format.space_after = Pt(2)
        doc.styles[name].paragraph_format.line_spacing = 1.18
    except KeyError:
        pass

title_style = doc.styles["Title"]
set_font(title_style, 20, bold=True, color=ACCENT, cjk=CJK_HEAD, west=WEST_HEAD)
title_style.paragraph_format.space_after = Pt(2)


def h1(text):
    doc.add_heading(text, level=1)


def h2(text):
    doc.add_heading(text, level=2)


def bullets(items):
    for it in items:
        p = doc.add_paragraph(it, style="List Bullet")
        p.paragraph_format.left_indent = Pt(16)


def para(text, italic=False):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.italic = italic
    return p


# ---------------- 封面标题 ----------------
t = doc.add_paragraph("JHYP 智能工作台 使用说明", style="Title")
t.alignment = WD_ALIGN_PARAGRAPH.CENTER
sub = doc.add_paragraph()
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = sub.add_run("面向日常使用者 · 说明各板块能做什么、彼此怎么配合")
r.font.size = Pt(9.5)
r.font.color.rgb = RGBColor(0x66, 0x66, 0x66)
sub.paragraph_format.space_after = Pt(10)

# ---------------- 一、使用前先了解 ----------------
h1("一、使用前先了解")
bullets([
    "用公司分配的账号登录后才能使用；忘记密码请联系管理员重置。",
    "能看到的菜单由账号角色决定：普通员工看到工作台、业务运营、AI 工作台；管理员额外看到系统管理。",
    "页面上的经营数字都来自公司已导入的 Amazon 报表。报表由人工导出、可能滞后，所以统计区间的截止日取“数据里最新的一天”，而不是今天。",
    "公告在每次登录后弹出，点“我知道了”、按 Esc 或点空白处都算已读，不会再重复弹出。",
])

# ---------------- 二、功能板块一览 ----------------
h1("二、功能板块一览")

h2("1. 工作台 · 仪表盘（登录后的首页）")
bullets([
    "一屏看到四个数字：需立即处理、分析记录、最近对话、知识沉淀（有待审时另标条数）。",
    "“开始工作”提供三个动作：继续上次分析、新建分析、问 AI。",
    "三个常用入口（AI 助手、竞品分析、个人知识库）可拖动排序，系统会记住你的顺序。",
    "下方列出最需要注意的分析、最近几次分析和最近几条对话，点一下即可回到对应记录或会话。",
])

h2("2. 业务运营 · 我的 ASIN")
bullets([
    "维护一份自己的商品清单：每件只需填商品编号和站点，可加别名、备注。",
    "可以单条添加，也可以下载模板后批量导入表格；导入前会先告诉你会新增多少条、哪些行读不出来。",
    "用表格或卡片两种方式查看，可按站点和近 7/30/90 天或自定义区间看广告花费、销售额、订单、销量等。",
    "报表里没有的数字可以手工补录，手工填写的会被优先采用，并标注“手工”。",
])

h2("3. 业务运营 · 竞品分析")
bullets([
    "输入 1–5 个商品编号（第一个视为自家商品），选站点和统计区间，一键生成横向对比与结论建议。",
    "自家报表数据与第三方公开数据分开呈现、不混算；第三方数据（价格、评分、排名、销量趋势、流量词、差评等）属于估算值。",
    "页面分三处：填写参数并看历史、查看某次分析的完整结论与数据、点商品卡片看单个竞品详情。",
    "每条结论都可以“标记已处理 / 不处理（需填原因）/ 复制处理步骤”，下次分析时系统会自动核验是否真的解决。",
])

h2("4. 业务运营 · 产品开发（标注“开发中”）")
bullets([
    "候选池：把准备上架的新品记录在一个可检索的池子里，支持粘贴或上传表格批量导入。",
    "对比与历史：勾选 2–10 个候选做横向对比，标明数据是人工录入还是公司报表，结果可保存回看。",
    "市场调研：按关键词找类目，查看市场规模、集中度、新品结构和价格带分布。",
    "目前只呈现事实，不给出“建议开发 / 不建议开发”的结论。",
])

h2("5. 业务运营 · 市场洞察")
bullets([
    "把类目和产品信息整理成可保存、可比较的市场分析，服务于选品判断和新品立项。",
    "现有两个页面：类目洞察（找类目、看市场分析）和报告记录（保存并回看历史报告）。",
    "保存下来的是当时的结果，以后打开不会用最新数据重算；每个人只能看到自己的报告。",
])

h2("6. AI 工作台 · AI 助手")
bullets([
    "用日常语言提问，系统从公司知识库和业务数据里找答案，回答带出处和数据截止时间。",
    "回答边生成边显示，可随时停止，也能重新生成；对回答可以点“有用 / 有问题”反馈。",
    "回答里的表格和趋势图来自真实业务数据，点“查看依据”能看到引用了哪些文档、用了哪些数据。",
    "左侧是会话列表：新建、搜索、置顶、重命名、删除（删除后不可恢复，审计记录仍保留）。",
    "输入框旁可插入提示词，也能把这次问答一键“沉淀为知识”。",
])

h2("7. AI 工作台 · 提示词广场")
bullets([
    "把反复要打的提问保存成模板，下次直接调出来用，不用重复输入。",
    "分“我的提示词”和“共享提示词”两页；写好的可以提报共享，管理员审核通过后全员可用，期间可撤回。",
    "正文旁的“优化提示词”由 AI 改写，结果先与原文对比，点“采用”才替换，之后还能撤销。",
])

h2("8. AI 工作台 · 知识库")
bullets([
    "个人知识库：自己的经验沉淀，可手工新建，也可从对话一键沉淀；可编辑、提交审核、归档、删除、导出。",
    "团队知识库：公司已生效的知识文档，普通员工只能查看；这些文档就是 AI 回答时引用的依据。",
    "自己提交的经验只有管理员审核通过后才会进入团队知识库，并标注提报人；未审核的内容不会被 AI 检索到。",
])

h2("9. 系统管理（仅管理员可见）")
bullets([
    "AI 治理 · 数据源与导入：把公司导出的报表导入系统，查看导入记录和数据覆盖情况——它是所有业务数字的唯一来源。",
    "AI 治理 · 经验审核：审批员工提交的经验沉淀与共享提示词，并统一设置经验整理的规则和次数上限。",
    "AI 治理 · 模型与配置：配置 AI 模型、外部数据工具、成本限制、可用工具开关。",
    "AI 治理 · 审计台：查看问答轨迹、被拦截的操作和管理动作，可导出；记录不可删除。",
    "用户管理：开通账号、修改姓名部门角色、启用停用、重置密码、删除账号（删除后相关数据一并清空，不可恢复）。",
    "公告管理：新建、编辑、发布、下线公告，设置“只弹一次”或“每次登录都弹”。",
])

# ---------------- 三、互通关联 ----------------
h1("三、板块之间如何关联使用")

h2("（一）所有板块共用同一份数据来源")
bullets([
    "管理员在“数据源与导入”里导入报表后，我的 ASIN、竞品分析、产品开发、市场洞察、AI 助手读到的是同一份数据。",
    "因此同一个指标在不同页面看到的数字是一致的；报表没有更新时，各页面的数字会一起偏少。",
])

h2("（二）我的 ASIN ↔ AI 助手")
bullets([
    "清单里的商品和手工补录的指标，AI 对话可以直接调用，结果与页面数字一致（手工填写的同样生效）。",
    "不同站点的金额不会相加，会按站点分别给出结果。",
])

h2("（三）AI 助手 ↔ 知识库（一条完整闭环）")
bullets([
    "对话中把有用的问答“沉淀为知识”→ 存入个人知识库 → 提交审核 → 管理员审核通过 → 进入团队知识库。",
    "进入团队知识库后，AI 回答时可能引用它，全员都能受益；文档被下线后不再被引用。",
])

h2("（四）提示词广场 ↔ AI 助手")
bullets([
    "在对话输入框输入 @ 或点“提示词”按钮，即可调出“我的提示词”和已审核通过的共享提示词。",
    "插入只是把内容填进输入框，不会自动发送；被调用的次数会记录在提示词广场。",
])

h2("（五）竞品分析 ↔ 仪表盘")
bullets([
    "首页的“需立即处理”“最近分析”直接取自竞品分析记录。",
    "在竞品分析里标记“已处理 / 不处理”后，首页的提醒会同步减少，形成处理闭环。",
])

h2("（六）竞品分析 ↔ AI 助手")
bullets([
    "在对话里可以直接问某次竞品分析的结论，系统只读取已保存的记录，不会重新抓数据、不额外消耗额度。",
])

h2("（七）竞品分析 ↔ 产品开发 ↔ 市场洞察（选品链路）")
bullets([
    "竞品分析的结果页可跳到市场调研查看所属类目情况；市场调研里的热门商品可以带回来做竞品对比。",
    "市场调研产生的报告由市场洞察负责保存与回看，产品开发负责发起检索和分析。",
    "三者共用同一份第三方数据：同一个类目不会在两个页面重复查询、重复消耗额度。",
])

h2("（八）公告、账号与全站")
bullets([
    "公告在登录后弹出，覆盖全站，与具体板块无关。",
    "账号角色决定能看到哪些菜单：管理员在“用户管理”里调整后，员工下次登录或刷新页面即生效。",
])

# ---------------- 四、使用提示 ----------------
h1("四、几点使用提示")
bullets([
    "数字对不上时先确认报表是否已更新：我的 ASIN 在报表缺失时显示“—”而不是 0。",
    "第三方公开数据是估算值，页面会标注来源，不要当成公司真实利润或平台官方数据。",
    "保存下来的分析结果和市场报告都是当时的结果，不会自动重算。",
    "删除会话、账号等操作不可恢复，系统会二次确认后再执行。",
    "产品开发整体标记“开发中”；市场洞察的产品地图、机会记录等能力仍在规划中。",
])

# ---------------- 页脚页码 ----------------
from docx.oxml import OxmlElement


def add_page_number(paragraph):
    run = paragraph.add_run()
    for instr, kind in (("begin", "fldChar"), ("PAGE", "instrText"), ("end", "fldChar")):
        el = OxmlElement("w:" + kind)
        if kind == "fldChar":
            el.set(qn("w:fldCharType"), instr)
        else:
            el.set(qn("xml:space"), "preserve")
            el.text = " PAGE "
        run._r.append(el)
    run.font.size = Pt(9)
    run.font.name = WEST_BODY
    run._r.rPr.rFonts.set(qn("w:eastAsia"), CJK_BODY)


footer_p = doc.sections[0].footer.paragraphs[0]
footer_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
add_page_number(footer_p)

doc.save(OUT)
print("saved:", OUT)
