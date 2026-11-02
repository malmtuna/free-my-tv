import io, os

files = ['CLAUDE.md', 'README.md', 'docs/index.html', 'docs/pt/index.html',
         'docs/webos/full_description.html', 'docs/webos/apps.json', 'tools/homebrew_repo.py']
old, new = 'simbasjungles', 'malmtuna'
for f in files:
    with io.open(f, encoding='utf-8', newline='') as fh:
        text = fh.read()
    n = text.count(old)
    if not n:
        print('%-38s no mention' % f)
        continue
    with io.open(f, 'w', encoding='utf-8', newline='') as fh:
        fh.write(text.replace(old, new))
    print('%-38s %d replaced' % (f, n))
