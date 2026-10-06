import state
def showWindow(i): state.S['window'] = i
def setFocused(i): state.S['focused'] = i
def setHintMsg(m): state.log('hint', msg=m)
