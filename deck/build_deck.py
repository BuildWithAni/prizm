"""Build the PRIZM pitch deck from the current product implementation.

Palette: white background, black primary text, gray secondary details.
"""

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn

# ---------------------------------------------------------------- palette
INK = RGBColor(0xFF, 0xFF, 0xFF)      # white slide background
CARD = RGBColor(0xF4, 0xF4, 0xF4)      # light gray panels
LINE = RGBColor(0xD4, 0xD4, 0xD4)      # gray dividers and borders
VOLT = RGBColor(0x18, 0x18, 0x18)      # black emphasis
DIM = RGBColor(0x6F, 0x6F, 0x6F)       # secondary gray text
BONE = RGBColor(0x18, 0x18, 0x18)      # primary black text

DISPLAY = "Segoe UI Black"
HEAD = "Segoe UI Semibold"
BODY = "Segoe UI"
MONO = "Consolas"

SW, SH = 13.333, 7.5
L, R = 0.75, 0.75
CW = SW - L - R
TOTAL = 11

prs = Presentation()
prs.slide_width = Inches(SW)
prs.slide_height = Inches(SH)
BLANK = prs.slide_layouts[6]

_n = {"i": 0}


# ---------------------------------------------------------------- helpers
def _nofill_line(shp):
    shp.line.fill.background()
    shp.shadow.inherit = False
    return shp


def rect(sl, x, y, w, h, color, shape=MSO_SHAPE.RECTANGLE):
    s = sl.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    s.fill.solid()
    s.fill.fore_color.rgb = color
    return _nofill_line(s)


def rrect(sl, x, y, w, h, fill=CARD, line=LINE, lw=1.0, adj=0.07):
    s = sl.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                            Inches(x), Inches(y), Inches(w), Inches(h))
    try:
        s.adjustments[0] = adj
    except Exception:
        pass
    if fill is None:
        s.fill.background()
    else:
        s.fill.solid()
        s.fill.fore_color.rgb = fill
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(lw)
    s.shadow.inherit = False
    return s


def hline(sl, x, y, w, color=LINE, th=0.014):
    return rect(sl, x, y, w, th, color)


def vline(sl, x, y, h, color=LINE, th=0.014):
    return rect(sl, x, y, th, h, color)


def connector(sl, x1, y1, x2, y2, color=LINE, w=1.25, dash=None):
    c = sl.shapes.add_connector(MSO_CONNECTOR.STRAIGHT,
                                Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    c.line.color.rgb = color
    c.line.width = Pt(w)
    if dash:
        ln = c.line._get_or_add_ln()
        d = ln.makeelement(qn("a:prstDash"), {"val": dash})
        ln.append(d)
    c.shadow.inherit = False
    return c


def tbox(sl, x, y, w, h, anchor=MSO_ANCHOR.TOP):
    tb = sl.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    return tf


def para(tf, text, size=12, color=BONE, font=BODY, bold=False, first=False,
         space_before=0, space_after=0, align=PP_ALIGN.LEFT, spacing=1.0,
         spc=None, italic=False):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align
    p.line_spacing = spacing
    p.space_before = Pt(space_before)
    p.space_after = Pt(space_after)
    r = p.add_run()
    r.text = text
    f = r.font
    f.name = font
    f.size = Pt(size)
    f.bold = bold
    f.italic = italic
    f.color.rgb = color
    if spc:
        r._r.get_or_add_rPr().set("spc", str(int(spc)))
    return p


def runs(tf, parts, size=12, font=BODY, bold=False, first=False,
         spacing=1.0, align=PP_ALIGN.LEFT, space_after=0, space_before=0):
    """parts = [(text, color, bold?, font?, size?), ...]"""
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align
    p.line_spacing = spacing
    p.space_after = Pt(space_after)
    p.space_before = Pt(space_before)
    for part in parts:
        text, color = part[0], part[1]
        r = p.add_run()
        r.text = text
        r.font.name = part[3] if len(part) > 3 and part[3] else font
        r.font.size = Pt(part[4] if len(part) > 4 and part[4] else size)
        r.font.bold = part[2] if len(part) > 2 and part[2] is not None else bold
        r.font.color.rgb = color
    return p


def new_slide(footer=True):
    sl = prs.slides.add_slide(BLANK)
    rect(sl, 0, 0, SW, SH, INK)
    rect(sl, 0, 0, 1.55, 0.07, VOLT)      # black top-left motif
    _n["i"] += 1
    if footer:
        hline(sl, L, 6.96, CW)
        tf = tbox(sl, L, 7.06, 9.0, 0.28)
        para(tf, "PRIZM  ·  ABHYUDAY 2026  ·  Startup India Hackathon-cum-Mentorship",
             size=8.5, color=DIM, font=MONO, first=True, spc=60)
        tf = tbox(sl, SW - R - 2.0, 7.06, 2.0, 0.28)
        para(tf, f"{_n['i']:02d} / {TOTAL}", size=8.5, color=VOLT, font=MONO,
             bold=True, first=True, align=PP_ALIGN.RIGHT, spc=60)
    return sl


def header(sl, kicker, title, sub=None):
    tf = tbox(sl, L, 0.5, CW, 0.26)
    para(tf, kicker, size=10.5, color=VOLT, font=MONO, bold=True, first=True, spc=150)
    tf = tbox(sl, L, 0.78, CW, 0.55)
    para(tf, title, size=29, color=BONE, font=HEAD, bold=True, first=True)
    y = 1.42
    if sub:
        tf = tbox(sl, L, 1.36, 11.0, 0.4)
        para(tf, sub, size=12.5, color=DIM, font=BODY, first=True, spacing=1.15)
        y = 1.84
    hline(sl, L, y, CW)
    return y + 0.24


def card(sl, x, y, w, h, title=None, body=None, accent=False,
         title_size=13, body_size=11, title_color=None, mono=False,
         body_gap=0.30, spacing=1.15):
    rrect(sl, x, y, w, h,
          fill=CARD, line=VOLT if accent else LINE, lw=1.5 if accent else 1.0)
    ty = y + 0.18
    if title:
        tf = tbox(sl, x + 0.22, ty, w - 0.44, 0.3)
        para(tf, title, size=title_size, color=title_color or BONE, font=HEAD,
             bold=True, first=True)
        ty += body_gap
    if body:
        lines = body if isinstance(body, (list, tuple)) else [body]
        tf = tbox(sl, x + 0.22, ty, w - 0.44, h - (ty - y) - 0.14)
        for i, ln in enumerate(lines):
            if isinstance(ln, tuple):
                txt, col = ln
            else:
                txt, col = ln, DIM
            para(tf, txt, size=body_size, color=col,
                 font=MONO if mono else BODY, first=(i == 0),
                 spacing=spacing, space_after=4)


def chip(sl, x, y, w, text, h=0.34, color=VOLT, size=9.5):
    rrect(sl, x, y, w, h, fill=None, line=color, lw=1.1, adj=0.5)
    tf = tbox(sl, x, y + 0.055, w, h, anchor=MSO_ANCHOR.TOP)
    para(tf, text, size=size, color=color, font=MONO, bold=True, first=True,
         align=PP_ALIGN.CENTER, spc=60)


def bullets(sl, x, y, w, items, row_h=0.66, gap=0.1, head_size=13,
            desc_size=11, marker=True):
    for i, it in enumerate(items):
        head, desc = it if isinstance(it, (tuple, list)) else (it, None)
        ry = y + i * (row_h + gap)
        if marker:
            rect(sl, x, ry + 0.07, 0.09, 0.09, VOLT)
        tx = x + (0.26 if marker else 0)
        tf = tbox(sl, tx, ry - 0.02, w - (tx - x), 0.28)
        para(tf, head, size=head_size, color=BONE, font=HEAD, bold=True, first=True)
        if desc:
            tf = tbox(sl, tx, ry + 0.26, w - (tx - x), row_h - 0.24)
            para(tf, desc, size=desc_size, color=DIM, font=BODY, first=True,
                 spacing=1.12)


def num_card(sl, x, y, w, h, num, title, body):
    rrect(sl, x, y, w, h, fill=CARD, line=LINE)
    tf = tbox(sl, x + 0.22, y + 0.16, 0.7, 0.42)
    para(tf, num, size=21, color=VOLT, font=MONO, bold=True, first=True)
    tf = tbox(sl, x + 0.22, y + 0.62, w - 0.44, 0.3)
    para(tf, title, size=13, color=BONE, font=HEAD, bold=True, first=True,
         spacing=1.05)
    tf = tbox(sl, x + 0.22, y + 0.95, w - 0.44, h - 1.08)
    para(tf, body, size=10.8, color=DIM, font=BODY, first=True, spacing=1.15)


def metric(sl, x, y, w, value, label, h=1.02):
    rrect(sl, x, y, w, h, fill=CARD, line=LINE)
    tf = tbox(sl, x + 0.18, y + 0.14, w - 0.36, 0.44)
    para(tf, value, size=22, color=VOLT, font=MONO, bold=True, first=True)
    tf = tbox(sl, x + 0.18, y + 0.60, w - 0.36, 0.36)
    para(tf, label, size=9.5, color=DIM, font=BODY, first=True, spacing=1.1)


# ========================================= 01 PROJECT TITLE & INTRODUCTION
sl = new_slide()
cy = header(sl, "01  ·  PROJECT TITLE & INTRODUCTION",
            "PRIZM — learning programming by watching it run")

tf = tbox(sl, L, cy, CW, 0.95)
para(tf, "The runtime determines what happened; the AI explains why it matters. "
         "Run programs in 13 language modes, watch genuine runtime traces step by step "
         "in 9, and read a plain-English story for every single step — then ask an AI "
         "tutor grounded in the selected line, frame and variable snapshots.",
     size=12, color=DIM, font=BODY, first=True, spacing=1.28)

xc = L
for t, w in [("9 TRACE ENGINES", 1.8), ("13 LANGUAGE MODES", 2.0),
             ("160 QA CHECKS", 1.9)]:
    chip(sl, xc, cy + 1.0, w, t)
    xc += w + 0.14

card(sl, L, cy + 1.5, 5.75, 2.0, "DETERMINISTIC PIPELINE",
     [("code → execution → trace → step story", BONE),
      "Each trace event carries real line, frame, variable and output data — the story can only describe what the machine did.",
      "Runs in 3 s with hard event and output caps."],
     title_size=11, mono=False, spacing=1.2)
card(sl, L + 6.08, cy + 1.5, 5.75, 2.0, "AI LEARNING PIPELINE",
     [("trace evidence → grounded explanation", BONE),
      "Pause a step for a 40-word AI insight, or open a full tutor conversation about the selected line — both forbidden from inventing values.",
      "Practice and assessment remain roadmap work."],
     title_size=11, spacing=1.2)

# --- must-mention block: team + mentor (Abhyuday 2026 guideline) -------------
ty_ = cy + 3.72
rrect(sl, L, ty_, CW, 1.42, fill=CARD, line=VOLT, lw=1.5)
tf = tbox(sl, L + 0.3, ty_ + 0.14, CW - 0.6, 0.26)
para(tf, "MUST MENTION  ·  TEAM & MENTOR", size=9.5, color=VOLT, font=MONO,
     bold=True, first=True, spc=140)
hline(sl, L + 0.3, ty_ + 0.42, CW - 0.6, LINE, th=0.01)

def _member(x, y, w, tag, name_ph, detail, name_size=13):
    tf = tbox(sl, x, y, w, 0.24)
    para(tf, tag, size=9, color=VOLT, font=MONO, bold=True, first=True, spc=110)
    tf = tbox(sl, x, y + 0.23, w, 0.3)
    para(tf, name_ph, size=name_size, color=BONE, font=HEAD, bold=True, first=True)
    tf = tbox(sl, x, y + 0.54, w, 0.42)
    para(tf, detail, size=9.5, color=DIM, font=BODY, first=True, spacing=1.15)

_member(L + 0.3, ty_ + 0.54, 3.9, "TEAM LEADER",
        "Anmol", "B.Tech CSE   ·   Program: B.Tech")
vline(sl, L + 4.4, ty_ + 0.52, 0.76, LINE)
_member(L + 4.65, ty_ + 0.54, 3.5, "TEAM MEMBERS",
        "Anirudh · Ankush · Kalpana · Gautam",
        "B.Tech CSE (all)", name_size=11.5)
vline(sl, L + 8.35, ty_ + 0.52, 0.76, LINE)
_member(L + 8.6, ty_ + 0.54, 3.0, "MENTOR",
        "Miss Niharika Mehra", "Abhyuday 2026 · Hindu College")


# ================================================== 04 (02) PROBLEM STATEMENT
sl = new_slide()
cy = header(sl, "02  ·  PROBLEM STATEMENT",
            "Beginners cannot see code think — and AI tutors make it worse")

data = [
    ("01", "Execution is invisible",
     "Variables change, loops repeat, recursion nests — none of it is visible. Students guess what the machine did instead of knowing."),
    ("02", "AI tutors hallucinate",
     "ChatGPT-style help confidently invents variable values, line numbers and outputs. Learners lose trust after the first wrong answer."),
    ("03", "Print debugging",
     "The default workaround is scattering print() calls — slow, noisy, and it teaches habits that break in real codebases."),
    ("04", "Tools show, but don't teach",
     "Visualisers show a picture without explanation; debuggers explain to experts. Nothing joins real runtime state with grounded AI teaching."),
]
cw = (CW - 3 * 0.28) / 4
for i, (n, t, b) in enumerate(data):
    num_card(sl, L + i * (cw + 0.28), cy, cw, 2.55, n, t, b)

rrect(sl, L, cy + 2.75, CW, 1.15, fill=CARD, line=VOLT, lw=1.5)
tf = tbox(sl, L + 0.3, cy + 2.93, CW - 0.6, 0.85)
runs(tf, [("THE GAP   ", VOLT, True, MONO, 11),
          ("Students need two things at the same moment: ", BONE, None, BODY, 14),
          ("what the runtime actually did", VOLT, True, BODY, 14),
          (" and ", BONE, None, BODY, 14),
          ("why it matters, in words they understand.", VOLT, True, BODY, 14)],
     first=True, spacing=1.25)
para(tf, "Today no single tool delivers both from the same source of truth.",
     size=12, color=DIM, font=BODY, space_before=6)

tf = tbox(sl, L, cy + 4.05, CW, 0.26)
para(tf, "PROBLEM SIZE — APPROX. / INDUSTRY ESTIMATES, ILLUSTRATIVE",
     size=9.5, color=VOLT, font=MONO, bold=True, first=True, spc=110)
mw = (CW - 3 * 0.26) / 4
for i, (v, lab) in enumerate([
        ("50M+", "beginners learning to code / yr (est.)"),
        ("≈ 40%", "of lab time lost to guessing (est.)"),
        ("3–5×", "faster fixes with step-through (est.)"),
        ("≈ 90%", "still debug with print / IDE (est.)")]):
    metric(sl, L + i * (mw + 0.26), cy + 4.33, mw, v, lab, h=0.85)


# ================================================ 05 (03) INNOVATION & UNIQUENESS
sl = new_slide()
cy = header(sl, "03  ·  INNOVATION & UNIQUENESS",
            "What nobody else ships together",
            "Four product choices that make PRIZM a learning environment, not just a code runner.")

items = [
    ("Story for every step — that can't lie",
     "A deterministic engine turns each real trace event into a headline, a what-happened paragraph, why it matters and a preview of the next step. It works instantly and offline, straight from runtime data.",
     "STEP STORIES"),
    ("Trace-grounded tutoring",
     "The tutor receives source, language, student level and the selected line, function, event, locals and output. Its system prompt forbids invented runtime values — so the bot is never confidently wrong.",
     "GROUNDING"),
    ("Snapshot per step",
     "Every trace event stores a full JSON snapshot of frame locals, so scrubbing backwards is always correct and never re-runs the program.",
     "ARCHITECTURE"),
    ("Cross-language, honest tracing",
     "Nine languages have runtime-backed tracing. Three more run without step-through; HTML renders in a sandboxed preview. Unsupported tracing is clearly identified.",
     "VISUALISER"),
]
iw = (CW - 0.3) / 2
for i, (t, b, tag) in enumerate(items):
    x = L + (i % 2) * (iw + 0.3)
    y = cy + (i // 2) * 1.75
    rrect(sl, x, y, iw, 1.55, fill=CARD, line=LINE)
    tf = tbox(sl, x + 0.24, y + 0.2, iw - 0.48, 0.3)
    runs(tf, [(f"0{i+1}  ", VOLT, True, MONO, 13), (t, BONE, True, HEAD, 14.5)],
         first=True)
    chip(sl, x + iw - 1.62, y + 0.17, 1.4, tag, h=0.28, size=8)
    tf = tbox(sl, x + 0.24, y + 0.58, iw - 0.48, 0.85)
    para(tf, b, size=11, color=DIM, font=BODY, first=True, spacing=1.18)

rrect(sl, L, cy + 3.5, CW, 0.7, fill=None, line=VOLT, lw=1.4)
tf = tbox(sl, L + 0.3, cy + 3.67, CW - 0.6, 0.4)
runs(tf, [("UNIQUE ANGLE   ", VOLT, True, MONO, 10.5),
          ("The only stack where the deterministic runtime and the AI pipeline are "
           "separate by design — the AI can only teach states the machine really produced.",
           BONE, None, BODY, 12.5)], first=True)


# ================================================ 06 (04) AI-POWERED SOLUTION
sl = new_slide()
cy = header(sl, "04  ·  AI-POWERED SOLUTION",
            "An AI tutor that reads the selected runtime step",
            "POST /api/tutor/explain sends source plus the selected trace evidence to OpenRouter; full-file `prizm` code replies can be applied to the editor.")

rrect(sl, L, cy, 6.6, 3.55, fill=CARD, line=LINE)
tf = tbox(sl, L + 0.26, cy + 0.2, 6.1, 0.3)
para(tf, "PROMPT ANATOMY — WHAT THE MODEL ACTUALLY SEES", size=10, color=VOLT,
     font=MONO, bold=True, first=True, spc=110)
rows = [
    ("system", "“values come from a REAL runtime trace — never guesswork”", VOLT),
    ("source", "the student's full program, fenced", DIM),
    ("step", "line · frame · event · variables (k = 3) · output ≤ 800 chars", BONE),
    ("history", "last 12 messages (24 allowed)", DIM),
    ("question", "student's question, ≤ 2000 chars", DIM),
]
ry = cy + 0.62
for k, v, col in rows:
    tf = tbox(sl, L + 0.26, ry, 1.1, 0.26)
    para(tf, k, size=10, color=VOLT, font=MONO, bold=True, first=True)
    tf = tbox(sl, L + 1.4, ry - 0.02, 4.9, 0.5)
    para(tf, v, size=11, color=col, font=BODY, first=True, spacing=1.1)
    ry += 0.44
hline(sl, L + 0.26, ry + 0.02, 6.08)
tf = tbox(sl, L + 0.26, ry + 0.18, 6.1, 0.5)
runs(tf, [("→  ", VOLT, True, MONO, 12),
          ("answer ≤ ~200 words, plus one fenced ", BONE, None, BODY, 11.5),
          ("prizm", VOLT, True, MONO, 11.5),
          (" block the student can click to apply straight into the editor.",
           BONE, None, BODY, 11.5)], first=True, spacing=1.15)

card(sl, L + 6.9, cy, 4.93, 1.55, "MODEL CHAIN (CONFIGURABLE)",
     ["Default: anthropic/claude-fable-5.1",
      "Fallbacks: Sonnet 5.5 → Haiku 5.5",
      "60 s timeout · output budget defaults to 2048 tokens",
      "≈ $0.005–0.02 (₹0.4–1.8) per answer (est.)"],
     title_size=10.5, mono=True, body_size=11, body_gap=0.36)

card(sl, L + 6.9, cy + 1.75, 4.93, 1.55, "CONTINUE + FALL BACK",
     ["Up to 3 continuation calls after cutoff",
      "402: shrink to affordable token budget",
      "429: wait patiently · 5xx: retry · model fallback"],
     title_size=10.5, mono=True, body_size=11, body_gap=0.36)

rrect(sl, L, cy + 3.7, CW, 0.78, fill=CARD, line=LINE)
tf = tbox(sl, L + 0.3, cy + 3.82, CW - 0.6, 0.58)
runs(tf, [("TWO AI MODES   ", VOLT, True, MONO, 10.5),
          ("Auto insight — one 40-word answer per step after a 0.75 s pause (12/run, cached)   ·   "
           "Ask tutor — full conversation grounded in the selected step.",
           BONE, None, BODY, 11)], first=True, spacing=1.15)
runs(tf, [("WHY IT'S DIFFERENT   ", VOLT, True, MONO, 10.5),
          ("Deterministic step story renders instantly and offline; AI only enhances it.",
           DIM, None, BODY, 11)], spacing=1.15, space_before=3)


# ============================================ 07 (05) TECHNOLOGY & IMPLEMENTATION
sl = new_slide()
cy = header(sl, "05  ·  TECHNOLOGY & IMPLEMENTATION",
            "Two pipelines, one shared contract")

stack = [("FRONTEND", ["Next.js 15 + TypeScript", "Journey step-story layer + AI insight hook", "Responsive 320–1440 px shell"]),
         ("BACKEND", ["FastAPI modular monolith", "Pydantic trace contracts", "Isolated child-process runner"]),
         ("TRACING", ["9 runtime-backed engines", "Shared call / line / return / exception schema", "Per-frame value snapshots"]),
         ("AI LAYER", ["OpenRouter chat completions", "Trace evidence + learner level", "Continuation + fallback chain"])]
sw_ = (CW - 3 * 0.26) / 4
for i, (t, lines) in enumerate(stack):
    x = L + i * (sw_ + 0.26)
    rrect(sl, x, cy, sw_, 1.7, fill=CARD, line=LINE)
    rect(sl, x, cy, sw_, 0.05, VOLT)
    tf = tbox(sl, x + 0.2, cy + 0.2, sw_ - 0.4, 0.26)
    para(tf, t, size=10, color=VOLT, font=MONO, bold=True, first=True, spc=120)
    tf = tbox(sl, x + 0.2, cy + 0.54, sw_ - 0.4, 1.05)
    for j, ln in enumerate(lines):
        para(tf, ln, size=11, color=BONE if j == 0 else DIM, font=BODY,
             first=(j == 0), spacing=1.1, space_after=5)

facts = [
    ("9 trace engines", "Python · JavaScript · TypeScript · Java · Kotlin · C · C++ · Go · Ruby"),
    ("13 language modes", "Three additional run-only languages plus sandboxed HTML/CSS/JS preview."),
    ("3 s / 2000 events", "Core Python tracer soft limit; capped trace keeps partial events on abort."),
    ("160 QA checks", "67 backend tests + 17 UI interaction + 76 responsive screens — all passing."),
]
fy = cy + 1.95
fw = (CW - 3 * 0.26) / 4
for i, (k, v) in enumerate(facts):
    x = L + i * (fw + 0.26)
    rrect(sl, x, fy, fw, 1.5, fill=None, line=LINE)
    tf = tbox(sl, x + 0.2, fy + 0.18, fw - 0.4, 0.34)
    para(tf, k, size=15, color=VOLT, font=MONO, bold=True, first=True)
    tf = tbox(sl, x + 0.2, fy + 0.58, fw - 0.4, 0.85)
    para(tf, v, size=10, color=DIM, font=BODY, first=True, spacing=1.15)

rrect(sl, L, fy + 1.75, CW, 1.2, fill=CARD, line=VOLT, lw=1.5)
tf = tbox(sl, L + 0.3, fy + 1.93, CW - 0.6, 0.9)
runs(tf, [("CURRENT SCOPE   ", VOLT, True, MONO, 10.5),
          ("13 modes · 9 trace engines · 160 QA checks", BONE, True, BODY, 13),
          ("  ·  six demo samples  ·  ", DIM, None, BODY, 12),
          ("5 / 30 daily visualizations", BONE, True, BODY, 13)], first=True, spacing=1.2)
para(tf, "Limits vary by engine. Core Python: 3 s soft limit, 2,000 events, 64 KB output; "
         "run sessions: 90 s / 128 KB. Estimated infra cost ≈ $0.002–0.01 (₹0.2–0.9) per traced "
         "run on a small VM (planning estimate). Child-process isolation is demo-grade, not a "
         "production sandbox.",
     size=11, color=DIM, font=BODY, space_before=6)


# ================================================== 08 (06) MIND MAP
sl = new_slide()
cy = header(sl, "06  ·  MIND MAP", "How the system thinks")

cx, cyy, cw_, ch_ = 5.45, 3.6, 2.44, 1.15
branches = [
    (L, cy, "RUNTIME", ["Real runner per language", "9 step-through engines", "Limits depend on engine"], "tl"),
    (8.08, cy, "JOURNEY", ["Step story from real trace data", "5 panels: journey · state · flow · tree · values", "Hot-path flowchart animation"], "tr"),
    (L, cy + 3.05, "AI TUTOR", ["Auto insight per step (12/run)", "Ask-tutor grounded in trace evidence", "Fallback on cost / availability"], "bl"),
    (8.08, cy + 3.05, "PRODUCT", ["13 language modes", "5 Free / 30 Pro daily traces", "Checkout is a no-charge demo"], "br"),
]
bw, bh = 4.5, 1.75
for x, y, title, leaves, pos in branches:
    rrect(sl, x, y, bw, bh, fill=CARD, line=LINE)
    tf = tbox(sl, x + 0.24, y + 0.18, bw - 0.48, 0.3)
    runs(tf, [(title, VOLT, True, MONO, 12), ("   ──", DIM, None, MONO, 12)], first=True)
    tf = tbox(sl, x + 0.24, y + 0.55, bw - 0.48, 1.05)
    for j, lf in enumerate(leaves):
        para(tf, lf, size=11, color=BONE if j == 0 else DIM, font=BODY,
             first=(j == 0), spacing=1.1, space_after=4)

rrect(sl, cx, cyy, cw_, ch_, fill=VOLT, line=None)
tf = tbox(sl, cx, cyy + 0.2, cw_, 0.8, anchor=MSO_ANCHOR.TOP)
para(tf, "PRIZM", size=17, color=INK, font=HEAD, bold=True, first=True,
     align=PP_ALIGN.CENTER, space_after=2)
para(tf, "trace ⇄ explain", size=10.5, color=INK, font=MONO, bold=True,
     align=PP_ALIGN.CENTER)

# connectors from centre to each branch
connector(sl, cx, cyy + 0.3, L + bw, cy + bh - 0.3, VOLT, 1.4)
connector(sl, cx + cw_, cyy + 0.3, 8.08, cy + bh - 0.3, VOLT, 1.4)
connector(sl, cx, cyy + ch_ - 0.3, L + bw, cy + 3.05 + 0.3, VOLT, 1.4)
connector(sl, cx + cw_, cyy + ch_ - 0.3, 8.08, cy + 3.05 + 0.3, VOLT, 1.4)


# ====================================================== 09 (07) WORKFLOW
sl = new_slide()
cy = header(sl, "07  ·  WORKFLOW",
            "From keystroke to explanation, in one pass")

steps = ["Write code\nin editor", "POST\n/executions", "Language\ntrace engine",
         "Shared\ntrace schema", "Step story\n+ AI insight", "5-panel\nvisual state"]
ch_w, ch_h = 2.12, 1.05
step_w = (CW - ch_w) / 5
sx = L
for i, s in enumerate(steps):
    shape = MSO_SHAPE.PENTAGON if i == 0 else MSO_SHAPE.CHEVRON
    sh = sl.shapes.add_shape(shape, Inches(sx), Inches(cy), Inches(ch_w), Inches(ch_h))
    sh.fill.solid()
    sh.fill.fore_color.rgb = VOLT if i in (2, 4) else CARD
    sh.line.color.rgb = VOLT if i in (2, 4) else LINE
    sh.line.width = Pt(1.2)
    sh.shadow.inherit = False
    tf = sh.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0.12)
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.line_spacing = 1.05
    for j, ln in enumerate(s.split("\n")):
        if j:
            p = tf.add_paragraph()
            p.alignment = PP_ALIGN.CENTER
            p.line_spacing = 1.05
        r = p.add_run()
        r.text = ln
        r.font.name = BODY
        r.font.size = Pt(10.5)
        r.font.bold = (j == 0)
        r.font.color.rgb = INK if i in (2, 4) else BONE
    tf2 = tbox(sl, sx + 0.1, cy + ch_h + 0.1, ch_w - 0.2, 0.3)
    para(tf2, f"step {i+1}", size=9, color=VOLT, font=MONO, bold=True, first=True,
         align=PP_ALIGN.CENTER, spc=80)
    sx += step_w

ry = cy + 1.7
rrect(sl, L, ry, 5.8, 1.6, fill=CARD, line=LINE)
tf = tbox(sl, L + 0.26, ry + 0.18, 5.3, 0.3)
para(tf, "EDITOR → PLAYBACK", size=10, color=VOLT, font=MONO, bold=True, first=True, spc=120)
tf = tbox(sl, L + 0.26, ry + 0.52, 5.3, 0.95)
para(tf, "Editor and /visualize share code, language and recorded trace — no "
         "re-running to go backwards. Every step gets a headline, what-happened, "
         "why-it-matters and a preview of next, built instantly from real values. "
         "Keyboard: ←/→, space, Home/End; speeds: 0.5×, 1×, 2×. "
         "Python flowchart nodes jump to a line.", size=11, color=BONE, font=BODY,
     first=True, spacing=1.2)

rrect(sl, L + 6.08, ry, 5.75, 1.6, fill=CARD, line=VOLT, lw=1.5)
tf = tbox(sl, L + 6.34, ry + 0.18, 5.25, 0.3)
para(tf, "ASK-BRANCH (AI LEARNING PIPELINE)", size=10, color=VOLT, font=MONO,
     bold=True, first=True, spc=120)
tf = tbox(sl, L + 6.34, ry + 0.52, 5.25, 0.95)
para(tf, "Pause a step → 40-word AI insight appears (12/run budget, cached). "
         "Ask freely → tutor receives source, level and the selected trace evidence "
         "→ grounded explanation; a complete `prizm` file can be applied back "
         "into the editor.", size=11, color=BONE, font=BODY, first=True, spacing=1.2)

rrect(sl, L, ry + 1.85, CW, 0.85, fill=None, line=LINE)
tf = tbox(sl, L + 0.3, ry + 2.02, CW - 0.6, 0.55)
runs(tf, [("SAFETY ON EVERY PASS   ", VOLT, True, MONO, 10.5),
          ("3.0 s soft limit  ·  2000 events  ·  64 KB output  ·  10 s hard kill  ·  "
           "filtered environment (19 allow-listed vars, no secrets)", BONE, None, BODY, 12)],
     first=True)


# ================================================ 10 (08) PROTOTYPE / DEMO
sl = new_slide()
cy = header(sl, "08  ·  PROTOTYPE / DEMO",
            "Working prototype — navigate the current workspace")
para(tbox(sl, L + 0.26, cy + 1.92, 3.8, 0.3),
     "Optional tutor key: OPENROUTER_API_KEY", size=9.5, color=DIM, font=BODY, italic=True, first=True)

rrect(sl, L, cy, 4.3, 3.0, fill=CARD, line=VOLT, lw=1.5)
tf = tbox(sl, L + 0.26, cy + 0.2, 3.8, 0.3)
para(tf, "STATUS: RUNNING LOCALLY", size=10, color=VOLT, font=MONO, bold=True,
     first=True, spc=110)
tf = tbox(sl, L + 0.26, cy + 0.58, 3.8, 2.3)
for i, ln in enumerate([
        "backend   uvicorn app.main:app  :8000",
        "frontend   npm run dev  →  :3000/editor",
        "tutor       OPENROUTER_API_KEY in .env",
        "qa           67 + 17 + 76 checks"]):
    para(tf, ln, size=10.5, color=BONE if i == 0 else DIM, font=MONO,
         first=(i == 0), spacing=1.15, space_after=7)
para(tf, "Runtime availability is reported by /api/languages.",
     size=9.5, color=DIM, font=BODY, italic=True, space_before=4)

demo = [
    "Open /editor → pick a language in the strip; runtime availability shown",
    "Run code → interactive console, stdin and stop control",
    "Visualize opens the Journey: headline, what/why/next for every step",
    "Pause → AI insight appears; ask the tutor anything about that step",
    "Step with ←/→ or space; speed 0.5× / 1× / 2×; 5 panels incl. hot-path flowchart",
    "Ask for a full-file fix; apply the suggested code straight into the editor",
]
bullets(sl, L + 4.6, cy, 7.25, [(f"0{i+1}   {d}", None) for i, d in enumerate(demo)],
        row_h=0.44, gap=0.06, head_size=12, marker=False)

tf = tbox(sl, L, cy + 3.25, CW, 0.3)
para(tf, "INCLUDED SAMPLE PROGRAMS", size=10, color=VOLT, font=MONO, bold=True,
     first=True, spc=130)
samples = ["python_showcase.py", "python_interactive.py", "python_crash.py",
           "fib.js", "sum_input.cpp", "Main.java"]
sxx = L
for s in samples:
    w = 0.082 * len(s) + 0.36
    chip(sl, sxx, cy + 3.58, w, s, h=0.36, color=DIM, size=9.5)
    sxx += w + 0.16

rrect(sl, L, cy + 4.1, CW, 0.55, fill=CARD, line=LINE)
tf = tbox(sl, L + 0.3, cy + 4.24, CW - 0.6, 0.3)
runs(tf, [("IMPLEMENTED   ", VOLT, True, MONO, 10),
          ("9 trace engines · 13 language modes · Journey step stories · per-step AI insight · "
           "hot-path flowchart · SQLite credit metering · responsive 320–1440 px", BONE, None, BODY, 11.5)],
     first=True)


# ==================================== 11 (09) TARGET USERS & MARKET POTENTIAL
sl = new_slide()
cy = header(sl, "09  ·  TARGET USERS & MARKET POTENTIAL",
            "Who benefits from seeing code execute step by step?")

users = [("STUDENTS", "Explore variables, loops, functions and recursion through real execution, not just final output."),
         ("EDUCATORS", "Demonstrate program behavior step by step; cohort progress dashboards are future scope."),
         ("SELF-LEARNERS", "Ask about a selected step or get a general code explanation before running."),
         ("DEVELOPERS", "Inspect supported programs, call stacks, values and execution paths.")]
uw = (CW - 3 * 0.26) / 4
for i, (t, b) in enumerate(users):
    x = L + i * (uw + 0.26)
    rrect(sl, x, cy, uw, 1.55, fill=CARD, line=LINE)
    tf = tbox(sl, x + 0.2, cy + 0.18, uw - 0.4, 0.28)
    para(tf, t, size=11, color=VOLT, font=MONO, bold=True, first=True, spc=100)
    tf = tbox(sl, x + 0.2, cy + 0.54, uw - 0.4, 0.9)
    para(tf, b, size=10.5, color=DIM, font=BODY, first=True, spacing=1.15)

fy = cy + 1.8
rrect(sl, L, fy, 5.8, 1.5, fill=None, line=LINE)
tf = tbox(sl, L + 0.26, fy + 0.18, 5.3, 1.2)
para(tf, "MARKET SIZE — APPROX. (ILLUSTRATIVE)", size=10, color=VOLT, font=MONO,
     bold=True, first=True, spc=120)
for i, ln in enumerate(["TAM  ≈ $10 B (₹88,000 cr)  ·  global online coding education",
                        "SAM  ≈ $1 B (₹8,800 cr)  ·  India + APAC tech learning",
                        "SOM  ≈ 1,000 learners / 20 colleges in Year 1 (target)"]):
    para(tf, ln, size=10.5, color=BONE if i == 2 else DIM, font=BODY,
         first=False, space_before=4 if i == 0 else 2, spacing=1.1)

rrect(sl, L + 6.08, fy, 5.75, 1.5, fill=None, line=LINE)
tf = tbox(sl, L + 6.34, fy + 0.18, 5.25, 1.2)
para(tf, "GO-TO-MARKET — PHASED", size=10, color=VOLT, font=MONO, bold=True,
     first=True, spc=120)
tf = tbox(sl, L + 6.34, fy + 0.5, 5.25, 0.95)
for i, ln in enumerate(["1  College hackathons & labs (built at Abhyuday 2026)",
                        "2  Schools, bootcamps and self-learners",
                        "3  LMS / ed-tech embedding via white-label API"]):
    para(tf, ln, size=10.5, color=BONE if i == 0 else DIM, font=BODY,
         first=(i == 0), space_after=3, spacing=1.1)

my = fy + 1.7
tf = tbox(sl, L, my, CW, 0.26)
para(tf, "MARKET & YEAR-1 TARGETS — APPROX. / ILLUSTRATIVE",
     size=9.5, color=VOLT, font=MONO, bold=True, first=True, spc=110)
mw = (CW - 3 * 0.26) / 4
for i, (v, lab) in enumerate([
        ("$10 B", "global coding-ed TAM (est.)"),
        ("$1 B", "India + APAC SAM (est.)"),
        ("1,000", "Year-1 learners (target)"),
        ("50", "Pro users ≈ $250 / ₹22K MRR")]):
    metric(sl, L + i * (mw + 0.26), my + 0.34, mw, v, lab, h=0.95)


# ======================================= 12 (10) REVENUE MODEL & ESTIMATED COST
sl = new_slide()
cy = header(sl, "10  ·  REVENUE MODEL & ESTIMATED COST",
            "Free and Pro tiers exist — payment is still a demo")

tf = tbox(sl, L, cy, 5.8, 0.3)
para(tf, "REVENUE STREAMS", size=10, color=VOLT, font=MONO, bold=True, first=True, spc=130)
streams = [
    ("Free  ·  $0 / ₹0", "5 visualizations / day · run in 13 modes · tutor included."),
    ("Pro  ·  $4.99 / mo (≈ ₹440)", "30 visualizations / day · priority tracing · Pro badge."),
    ("Payment status", "Checkout is simulated: fields are ignored; no processor or charge."),
    ("Institution licence (est.)", "₹50K–2 L / lab / yr — proposal only, not built billing."),
]
sy = cy + 0.34
for i, (t, b) in enumerate(streams):
    rrect(sl, L, sy, 5.8, 0.86, fill=CARD, line=VOLT if i == 1 else LINE,
          lw=1.5 if i == 1 else 1.0)
    tf = tbox(sl, L + 0.24, sy + 0.14, 5.3, 0.28)
    para(tf, t, size=12.5, color=BONE, font=HEAD, bold=True, first=True)
    tf = tbox(sl, L + 0.24, sy + 0.44, 5.3, 0.34)
    para(tf, b, size=10.5, color=DIM, font=BODY, first=True, spacing=1.1)
    sy += 0.96

tf = tbox(sl, L + 6.08, cy, 5.75, 0.3)
para(tf, "COST MODEL — APPROX., PILOT ≈ 1,000 USERS / MONTH", size=10, color=VOLT,
     font=MONO, bold=True, first=True, spc=110)
costs = [("Frontend hosting (Vercel Pro)", "$0–20 · ₹0–1.7K"),
         ("Backend VM / container", "$5–20 · ₹440–1.8K"),
         ("OpenRouter AI tokens", "$15–50 · ₹1.3–4.4K"),
         ("Domain, e-mail, monitoring", "$1–5 · ₹90–440"),
         ("Storage (SQLite → Postgres)", "$0–5 · ₹0–440")]
ry = cy + 0.4
rrect(sl, L + 6.08, ry, 5.75, 3.0, fill=CARD, line=LINE)
ry += 0.14
for i, (k, v) in enumerate(costs):
    tf = tbox(sl, L + 6.34, ry, 3.2, 0.3)
    para(tf, k, size=10.5, color=BONE, font=BODY, first=True)
    tf = tbox(sl, L + 9.6, ry, 2.0, 0.3)
    para(tf, v, size=9.5, color=VOLT, font=MONO, bold=True, first=True,
         align=PP_ALIGN.RIGHT)
    ry += 0.46
    if i < len(costs) - 1:
        hline(sl, L + 6.34, ry - 0.09, 5.23, LINE, th=0.008)
hline(sl, L + 6.34, ry + 0.0, 5.23, VOLT, th=0.014)
tf = tbox(sl, L + 6.34, ry + 0.16, 3.2, 0.3)
para(tf, "Est. monthly total (pilot)", size=11.5, color=BONE, font=HEAD, bold=True, first=True)
tf = tbox(sl, L + 9.3, ry + 0.13, 2.3, 0.3)
para(tf, "≈ $21–100 · ₹1.8–8.8K", size=11, color=VOLT, font=MONO, bold=True, first=True,
     align=PP_ALIGN.RIGHT)

rrect(sl, L + 6.08, cy + 3.55, 5.75, 1.0, fill=None, line=VOLT, lw=1.4)
tf = tbox(sl, L + 6.34, cy + 3.68, 5.25, 0.8)
runs(tf, [("METERING   ", VOLT, True, MONO, 10),
          ("1 visualization = 1 credit. Daily limits: Free 5, Pro 30. "
           "Run sessions and AI tutor are not charged credits. No actual payment yet.",
           BONE, None, BODY, 10.5)], first=True, spacing=1.15)
runs(tf, [("BREAK-EVEN   ", VOLT, True, MONO, 10),
          ("≈ 5–20 Pro subscribers (50 × $4.99 ≈ $250 ≈ ₹22K MRR) cover the "
           "pilot run cost.", BONE, None, BODY, 10.5)], spacing=1.15, space_before=4)

rrect(sl, L, cy + 4.3, 5.8, 0.62, fill=None, line=LINE)
tf = tbox(sl, L + 0.24, cy + 4.42, 5.3, 0.42)
runs(tf, [("YEAR-1 REVENUE (EST.)   ", VOLT, True, MONO, 9.5),
          ("1,000 learners × 5% Pro ≈ 50 × $4.99 ≈ $250/mo (₹22K) — plus "
           "institution licences (est. ₹50K–2L/yr per lab).",
           DIM, None, BODY, 10)], first=True, spacing=1.1)


# ================================ 13 (11) BENEFITS, SCALABILITY & FUTURE SCOPE
sl = new_slide()
cy = header(sl, "11  ·  BENEFITS, SCALABILITY & FUTURE SCOPE",
            "Why it matters now — and where it goes next")

cols = [
    ("BENEFITS", VOLT, [
        ("Every step explains itself", "A story per step — headline, what, why, next — from real runtime values."),
        ("Trustworthy AI", "Deterministic story first; AI insight enhances it, never invents values."),
        ("Learn by doing", "Change code → new trace; scrub backwards without re-running."),
        ("Safe to experiment", "Capped, isolated runs — crash, abort, repeat.")]),
    ("SCALABILITY", BONE, [
        ("13 modes, 9 tracers", "Runtime availability is detected per machine; trace support is not claimed where absent."),
        ("Persistent credit counters", "SQLite survives API restarts; per-client identity is browser-local, no sign-in."),
        ("QA on every screen size", "160 automated checks: 67 backend tests, 17 UI interaction flows, 76 responsive views."),
        ("Production hardening needed", "Current child-process isolation is demo-grade; container / trusted sandbox is future work.")]),
    ("FUTURE SCOPE", BONE, [
        ("Evidence of learning", "Prediction questions, exercises and progress tracking are roadmap items."),
        ("Class & cohort dashboards", "Educators see where a batch loses the plot."),
        ("Assessment engine", "Auto-graded tasks built on real execution traces."),
        ("Trace parity + flowcharts", "Extend beyond Python flowcharts; improve engine depth and consistency.")]),
]
colw = (CW - 2 * 0.3) / 3
for i, (title, tcol, rows) in enumerate(cols):
    x = L + i * (colw + 0.3)
    rrect(sl, x, cy, colw, 4.4, fill=CARD, line=VOLT if i == 0 else LINE,
          lw=1.5 if i == 0 else 1.0)
    tf = tbox(sl, x + 0.26, cy + 0.18, colw - 0.52, 0.3)
    para(tf, title, size=11, color=VOLT, font=MONO, bold=True, first=True, spc=140)
    hline(sl, x + 0.26, cy + 0.54, colw - 0.52)
    ry = cy + 0.72
    for j, (h, b) in enumerate(rows):
        rect(sl, x + 0.26, ry + 0.07, 0.08, 0.08, VOLT)
        tf = tbox(sl, x + 0.48, ry - 0.03, colw - 0.74, 0.32)
        para(tf, h, size=12.5, color=BONE, font=HEAD, bold=True, first=True,
             spacing=1.05)
        tf = tbox(sl, x + 0.48, ry + 0.33, colw - 0.74, 0.55)
        para(tf, b, size=10.5, color=DIM, font=BODY, first=True, spacing=1.15)
        ry += 0.9

rrect(sl, L, cy + 4.58, CW, 0.7, fill=None, line=VOLT, lw=1.4)
tf = tbox(sl, L + 0.3, cy + 4.7, CW - 0.6, 0.5)
runs(tf, [("SCALE ECONOMICS (APPROX.)   ", VOLT, True, MONO, 10),
          ("1 K users ≈ $21–100 / mo (₹1.8–8.8K)  ·  10 K users ≈ $60–250 / mo "
           "(₹5.4–22K, AI-dominated)  ·  500 Pro ≈ $2.5 K MRR (₹2.2 L)",
           BONE, None, BODY, 11)], first=True, spacing=1.15)
runs(tf, [("Growth plan: ", VOLT, True, MONO, 10),
          ("container sandbox + hosted Postgres + LMS API are the three spend "
           "steps ahead.", DIM, None, BODY, 10.5)], spacing=1.15, space_before=3)


out = r"C:\Users\Anirudh\Desktop\prizm\deck\PRIZM-Abhyuday2026-PitchDeck.pptx"
prs.save(out)
print("saved", out, "| slides:", len(prs.slides._sldIdLst))
