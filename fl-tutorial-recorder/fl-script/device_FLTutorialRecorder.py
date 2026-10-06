#name=FL Tutorial Recorder
#url=https://github.com/ayosavvageloops-create/workspace-master
#
# Bridge between FL Studio and the FL Tutorial Recorder app.
# The app talks to this script over a MIDI port with SysEx messages:
#   F0 7D 46 54 <hex of UTF-8 text> F7
# where the text is "command|arg|arg...". Replies use the same framing.

import transport
import patterns
import channels
import ui
import device
import mixer

VERSION = '2'
HEAD = bytes([0xF0, 0x7D, 0x46, 0x54])
WINDOWS = {'rack': 1, 'playlist': 2, 'piano': 3}  # widChannelRack, widPlaylist, widPianoRoll


greeted = False


def hint(msg):
    # Shows up in FL's hint bar, so the user can see the script is alive without our app.
    try:
        ui.setHintMsg(msg)
    except Exception:
        pass


def send(*fields):
    if not device.isAssigned():
        return
    text = '|'.join(str(f).replace('|', '/') for f in fields)
    device.midiOutSysex(HEAD + text.encode('utf-8').hex().encode('ascii') + bytes([0xF7]))


def tempo():
    try:
        t = mixer.getCurrentTempo()
        return round(t / 1000.0, 3) if t > 1000 else t
    except Exception:
        return 0


def clean(name):
    return str(name).replace('\t', ' ').replace('|', '/')


def show(view, channel):
    wid = WINDOWS.get(view)
    if wid is None:
        return
    if view == 'piano' and channel >= 0:
        channels.selectOneChannel(channel)
    ui.showWindow(wid)
    ui.setFocused(wid)


def pattern_mode(on):
    # getLoopMode: 0 = pattern, 1 = song; setLoopMode toggles
    if (transport.getLoopMode() == 0) != on:
        transport.setLoopMode()


def list_project():
    pats = []
    for i in range(1, patterns.patternCount() + 1):
        empty = 1 if patterns.isPatternDefault(i) else 0
        pats.append('%d~%s~%d' % (i, clean(patterns.getPatternName(i)), empty))
    chans = [clean(channels.getChannelName(c, True)) for c in range(channels.channelCount(True))]
    send('list', tempo(), '\t'.join(pats), '\t'.join(chans), patterns.patternNumber())


def OnInit():
    print('FL Tutorial Recorder: script loaded, output linked: %s' % device.isAssigned())
    hint('FL Tutorial Recorder: скрипт загружен')
    send('hello', VERSION)


def OnSysEx(event):
    global greeted
    data = bytes(event.sysex)
    if not data.startswith(HEAD):
        return
    event.handled = True
    try:
        msg = bytes.fromhex(data[len(HEAD):-1].decode('ascii')).decode('utf-8')
    except Exception:
        return
    f = msg.split('|')
    cmd = f[0]
    try:
        if cmd == 'hello':
            if not greeted:
                greeted = True
                if device.isAssigned():
                    hint('FL Tutorial Recorder: связь есть')
                else:
                    hint('FL Tutorial Recorder: команды доходят, но не настроен Output (Port 10)')
                print('FL Tutorial Recorder: app connected, output linked: %s' % device.isAssigned())
            send('hello', VERSION, 1 if device.isAssigned() else 0)
        elif cmd == 'list':
            list_project()
        elif cmd == 'play':
            # play|<pattern>|<view>|<channel>: loop one pattern from its start
            pat, view, ch = int(f[1]), f[2], int(f[3])
            transport.stop()
            pattern_mode(True)
            patterns.jumpToPattern(pat)
            transport.setSongPos(0)
            show(view, ch)
            transport.start()
            send('ok', 'play', pat)
        elif cmd == 'song':
            # song|<view>: whole arrangement from the top
            transport.stop()
            pattern_mode(False)
            transport.setSongPos(0)
            show(f[1] if len(f) > 1 else 'playlist', -1)
            transport.start()
            send('ok', 'song')
        elif cmd == 'stop':
            transport.stop()
            send('ok', 'stop')
    except Exception as e:
        send('err', cmd, e)
