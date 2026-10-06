import sys
def isAssigned(): return True
def midiOutSysex(b): sys.stdout.write(bytes(b).hex() + '\n'); sys.stdout.flush()
