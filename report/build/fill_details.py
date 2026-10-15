p = 'ch_front_and_design.py'
s = open(p, encoding='utf-8').read()
s = s.replace('[STUDENT NAME — TO BE FILLED]', 'ABHISHEK KANDAVEL')
s = s.replace('[REGISTER NUMBER — TO BE FILLED]', '24BCE5424')
s = s.replace('[FACULTY NAME — TO BE FILLED]', 'PARVATHY AK')
s = s.replace('I would like to thank the course faculty of Database Systems at VIT for',
              'I would like to thank my course faculty, Parvathy AK, and the Database Systems faculty at VIT for')
open(p, 'w', encoding='utf-8').write(s)

p = 'build_report.py'
s = open(p, encoding='utf-8').read()
s = s.replace('doc.core_properties.author = "[Student name]"', 'doc.core_properties.author = "Abhishek Kandavel"')
open(p, 'w', encoding='utf-8').write(s)
print('details filled')
