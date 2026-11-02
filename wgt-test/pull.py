import importlib.util, os, struct

spec = importlib.util.spec_from_file_location('tizinstall', os.path.join('tizen', 'install.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

sdb = m.Sdb('192.168.18.193')

def pull(path):
    stream = sdb.open('sync:')
    sdb.write(stream, b'RECV' + struct.pack('<I', len(path)) + path.encode())
    local = stream[0]
    buf = b''
    while True:
        cmd, remote, l, payload = sdb.read()
        if cmd == b'WRTE':
            buf += payload
            sdb.send(b'OKAY', local, remote)
        elif cmd == b'CLSE':
            break
        elif cmd == b'OKAY':
            continue
        else:
            break
    if buf[:4] == b'FAIL':
        return None, buf[8:].decode('utf-8', 'replace')
    if buf[:4] == b'DATA':
        n = struct.unpack('<I', buf[4:8])[0]
        return buf[8:8 + n], 'ok'
    return buf, 'odd'

for path in ('/opt/usr/home/owner/apps_rw/FreeMyTVio.FreeMyTV/config.xml',
             '/opt/usr/apps/FreeMyTVio.FreeMyTV/config.xml'):
    data, status = pull(path)
    print(path, '->', status, len(data) if data else 0)
    if data:
        text = data.decode('utf-8', 'replace')
        print('   service declared:', 'FreeMyTVio.FreeMyTVWatch' in text)
        print('   background-support:', 'background-support="enable"' in text)
        break
