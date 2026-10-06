import state
NAMES = ['Loop', 'Kick', 'Open Hat', 'Hi-Hat', 'Snare', 'Pattern 6']
def patternCount(): return len(NAMES)
def patternNumber(): return state.S['pattern']
def getPatternName(i): return NAMES[i - 1]
def isPatternDefault(i): return NAMES[i - 1].startswith('Pattern')
def jumpToPattern(i):
    assert 1 <= i <= len(NAMES), 'bad pattern %r' % i
    state.S['pattern'] = i
