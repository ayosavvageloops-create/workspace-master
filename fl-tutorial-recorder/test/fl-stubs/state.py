import sys, json
S = {'loop': 1, 'pattern': 1, 'playing': False, 'window': None, 'channel': None}
def log(ev, **kw):
    sys.stderr.write(json.dumps(dict(ev=ev, window=S['window'], channel=S['channel'], **kw)) + '\n'); sys.stderr.flush()
