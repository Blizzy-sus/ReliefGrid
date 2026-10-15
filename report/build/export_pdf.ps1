# Opens the DOCX in Microsoft Word, updates every field (TOC, lists of figures/tables, captions, page numbers),
# saves it, and exports the PDF with heading bookmarks.
param(
  [string]$Docx = (Join-Path $PSScriptRoot '..\ReliefGrid_DBMS_Report.docx'),
  [string]$Pdf  = (Join-Path $PSScriptRoot '..\ReliefGrid_DBMS_Report.pdf')
)
$Docx = (Resolve-Path $Docx).Path
$Pdf = [System.IO.Path]::GetFullPath($Pdf)
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($Docx)
  $doc.Repaginate()
  for ($pass = 1; $pass -le 3; $pass++) {
    [void]$doc.Fields.Update()
    foreach ($t in $doc.TablesOfFigures) { $t.Update() }
    foreach ($t in $doc.TablesOfContents) { $t.Update() }
    $doc.Repaginate()
  }
  $doc.Save()
  $doc.ExportAsFixedFormat($Pdf, 17, $false, 0, 0, 1, 1, 0, $true, $true, 1)
  Write-Output ("Pages: " + $doc.ComputeStatistics(2))
  $doc.Close($false)
} finally {
  $word.Quit()
}
Write-Output "PDF written: $Pdf"
