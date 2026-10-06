import state
NAMES = ['Kick', 'Open Hat', 'Hi-Hat', 'Snare', 'Loop Piano']
def channelCount(globalCount=False): return len(NAMES)
def getChannelName(i, useGlobalIndex=False): return NAMES[i]
def selectOneChannel(i, useGlobalIndex=False): state.S['channel'] = i
