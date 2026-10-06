# Runs the real FL script against stub FL modules. stdin/stdout carry raw MIDI bytes as hex lines.
import sys, os
here = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(here, 'fl-stubs'), os.path.join(here, '..', 'fl-script')]
import device_FLTutorialRecorder as script

class Event:
    def __init__(self, data): self.sysex = data; self.handled = False

script.OnInit()
for line in sys.stdin:
    line = line.strip()
    if line:
        script.OnSysEx(Event(bytes.fromhex(line)))
