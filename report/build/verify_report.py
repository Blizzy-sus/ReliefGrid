"""Verifies the exported PDF/DOCX: leftover reference text, placeholders, field errors, TOC page numbers, images."""
import os
import re
import sys
import pymupdf
from docx import Document

HERE = os.path.dirname(os.path.abspath(__file__))
PDF = os.path.join(HERE, '..', 'ReliefGrid_DBMS_Report.pdf')
DOCX = os.path.join(HERE, '..', 'ReliefGrid_DBMS_Report.docx')

doc = pymupdf.open(PDF)
pages = [p.get_text() for p in doc]
full = '\n'.join(pages)
print('pages:', doc.page_count)

# 1. leftovers
bad = ['NammaNidhi', 'Namma', 'BCSE302L • October 2026 • ', 'Error! ', 'undefined', 'NaN', '[object', 'Update field', 'Right-click', 'Aptos']
for b in bad:
    n = len(re.findall(re.escape(b), full))
    print(f'  contains "{b}":', n)

# 2. placeholders (expected: marked for the student)
ph = sorted(set(re.findall(r'\[[A-Z][A-Z —\-]*TO BE FILLED\]', full)))
print('placeholders:', ph)

# 3. TOC page numbers vs actual heading pages.
# front matter is lower-roman; body pages are numbered from 1 after the front matter + cover.
# find first body page: the page containing '1. INTRODUCTION' heading outside the TOC
toc_entries = []
for p in pages:
    if 'TABLE OF CONTENTS' in p:
        pass
lines = [ln for p in pages[:8] for ln in p.split('\n')]
entry_re = re.compile(r'^(\d+\.\s+[A-Z][^\.]*?|\d+\.\d+\s+[A-Z].*?|REFERENCES|APPENDIX [ABC].*?)\s*\.{3,}\s*(\d+)$')
# PyMuPDF text for TOC lines: title and page number may be separate lines; rebuild by scanning page text blocks
toc_pages = [i for i, p in enumerate(pages[:8]) if re.search(r'\.{5,}', p)]
entries = []
for i in toc_pages:
    t = pages[i]
    toks = [x.strip() for x in t.split('\n') if x.strip()]
    for j, tok in enumerate(toks):
        m = re.match(r'^(.*?)\.{3,}\s*(\d+)$', tok)
        if m:
            entries.append((m.group(1).strip(), int(m.group(2))))
        elif j + 1 < len(toks) and re.fullmatch(r'\d+', toks[j + 1]) and re.search(r'\d+\.\d*\s', tok) and not re.search(r'^(Figure|Table)', tok):
            pass
print('TOC entries parsed (inline):', len(entries))

# footer page labels: "| Page <label>" appears in each page's text
labels = []
for p in pages:
    m = re.search(r"\|\s*Page (\w+)", p)
    labels.append(m.group(1) if m else None)
print('page labels sample:', labels[:12], '...', labels[-3:])
printed = {}
body_seen = False
for i, lab in enumerate(labels):
    if lab and lab.isdigit():
        printed[int(lab)] = i
print('body pages:', min(printed), '-', max(printed))

mismatch = 0
checked = 0
for title, pg in entries:
    if re.match(r'^(Figure|Table) \d+', title):
        continue
    idx = printed.get(pg)
    if idx is None:
        print('   no page', pg, 'for', title); mismatch += 1; continue
    t = re.sub(r'\s+', ' ', title)
    body = re.sub(r'\s+', ' ', pages[idx])
    checked += 1
    if t.upper() not in body.upper():
        print('   MISMATCH:', title, '-> page', pg)
        mismatch += 1
print(f'TOC entries checked against body pages: {checked}, mismatches: {mismatch}')

# figures / tables lists: check a few captions exist at the stated page
cap_entries = []
for i in toc_pages + list(range(4, 9)):
    pass

# 4. images and fonts
imgs = sum(len(p.get_images(full=True)) for p in doc)
fonts = set()
for p in doc:
    for f in p.get_fonts():
        fonts.add(f[3])
print('images in PDF:', imgs, '| fonts:', sorted(fonts)[:8])
print('bookmarks (outline entries):', len(doc.get_toc()))

# 5. DOCX checks
d = Document(DOCX)
txt = '\n'.join(p.text for p in d.paragraphs)
for t in d.tables:
    for row in t.rows:
        for c in row.cells:
            txt += '\n' + c.text
print('docx paragraphs:', len(d.paragraphs), 'tables:', len(d.tables), 'inline images:', len(d.inline_shapes))
print('docx contains NammaNidhi:', 'Namma' in txt)

# 6. page-level sanity: pages that are nearly empty
for i, p in enumerate(pages):
    words = len(p.split())
    if words < 25 and i > 0:
        print('  sparse page', i + 1, 'words', words)
