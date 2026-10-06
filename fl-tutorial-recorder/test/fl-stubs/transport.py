import state
def start(): state.log('start', mode=state.S['loop'], pattern=state.S['pattern']); state.S['playing'] = True
def stop(): state.S['playing'] = False; state.log('stop')
def isPlaying(): return state.S['playing']
def getLoopMode(): return state.S['loop']
def setLoopMode(): state.S['loop'] = 1 - state.S['loop']
def setSongPos(pos, mode=-1): state.S['pos'] = pos
