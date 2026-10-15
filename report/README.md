# ReliefGrid project report

| File | What it is |
|---|---|
| `ReliefGrid_DBMS_Report.pdf` | Submission copy (72 pages, Letter): cover, front matter, 17 chapters, references, appendices |
| `ReliefGrid_DBMS_Report.docx` | Editable version (same content; table of contents, lists of figures/tables and page numbers are Word fields) |
| `assets/` | Screenshots (`screens/`), diagrams (`diagrams/`) and the web-sized copies embedded in the report |
| `build/` | The scripts that produced everything above from the real project |

## Fill in before submitting

Three placeholders on the **cover page** (search for `TO BE FILLED`): student name, register number, faculty name. Also set the author in *File → Info → Properties* if you wish. After editing the DOCX, press **Ctrl+A, F9** (update all fields) and use *File → Save As → PDF* to regenerate the PDF; page numbers and the table of contents will refresh.

The course code (BCSE302L) and programme/campus lines follow the sample report and your VIT Chennai context; change them if they differ.

## Every number in the report is reproducible

Chapter 15 and the appendices only use results produced by commands in Appendix B of the report (`npm test`, `npm run scenarios`, `npm run queries`, plus the schema introspection scripts below). Nothing is estimated.

## Rebuilding the report

Prerequisites: the ReliefGrid project set up (`npm install`), Python 3 with `python-docx`, `pillow` and `pymupdf`, Microsoft Word (for field updates and PDF export), and a Chromium-based browser (Edge) for screenshots and diagrams.

```bash
cd report/build
npm install                          # puppeteer-core (screenshots and diagrams only)

# 1. start the app on a freshly seeded database (from the project root)
#      npm run seed && npm start
node screens.mjs                     # 33 screenshots -> assets/screens (drives the real UI as each role)

# 2. diagrams, generated from the live schema and the real engine
node --disable-warning=ExperimentalWarning diagrams.mjs
node --disable-warning=ExperimentalWarning er_diagram.mjs

# 3. collect facts (query outputs, schema, routes, code statistics) and test output
node --disable-warning=ExperimentalWarning collect.mjs
#      npm test > build/data/test_output.txt   (run from the project root)
#      npm run scenarios                         (regenerates docs/RESULTS.md)

# 4. build and export
python build_report.py               # writes ../ReliefGrid_DBMS_Report.docx
powershell -ExecutionPolicy Bypass -File export_pdf.ps1   # updates fields, writes the PDF
python verify_report.py              # checks leftovers, TOC page numbers, images
```
