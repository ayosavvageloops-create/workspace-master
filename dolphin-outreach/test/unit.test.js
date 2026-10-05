import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArtists, normalizeUsername, parseCsv } from '../src/csv.js';
import { renderOpener, spin, pickTemplate } from '../src/templates.js';
import { DB } from '../src/db.js';

const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const tmpDb = () => new DB(fs.mkdtempSync(path.join(os.tmpdir(), 'do-test-')));

test('normalizeUsername: ссылки, @, мусор', () => {
  assert.equal(normalizeUsername('https://www.instagram.com/Lil.Artist/?hl=en'), 'lil.artist');
  assert.equal(normalizeUsername('@some_guy '), 'some_guy');
  assert.equal(normalizeUsername('not a user!'), '');
});

test('parseArtists: экспорт Artist Finder', () => {
  const csv = 'artist,instagram,track,template,message,email,spotify_url\n' +
    'Lil A,@lil.a,Night Drive,t1,"Yo bro, ""Night Drive"" hits",a@x.com,https://open.spotify.com/x\n' +
    'Bad,???,,,,,\n';
  const { artists, invalid } = parseArtists(csv);
  assert.equal(artists.length, 1);
  assert.deepEqual(artists[0].username, 'lil.a');
  assert.equal(artists[0].name, 'Lil A');
  assert.equal(artists[0].opener, 'Yo bro, "Night Drive" hits');
  assert.equal(artists[0].fields.track, 'Night Drive');
  assert.equal(artists[0].fields.spotify_url, 'https://open.spotify.com/x');
  assert.equal(invalid.length, 1);
});

test('parseArtists: без заголовка, TSV и многострочный опенер', () => {
  const { artists } = parseArtists('foo\tFoo Bar\t"line1\nline2"\nbar\n');
  assert.equal(artists.length, 2);
  assert.equal(artists[0].opener, 'line1\nline2');
  assert.equal(artists[1].username, 'bar');
  assert.equal(parseCsv('a;b;c\n1;2;3')[1][2], '3');
});

test('шаблоны: переменные, фолбэк, спинтакс', () => {
  const a = { username: 'kid', name: 'Kid Cudi', fields: { track: 'Pursuit' } };
  assert.equal(renderOpener('{Yo|Hey} {{first_name}}, {{track}} is fire', a, seq(0)).text, 'Yo Kid, Pursuit is fire');
  assert.equal(renderOpener('Yo {{first_name:bro}}!', { username: 'x', fields: {} }).text, 'Yo bro!');
  const r = renderOpener('Yo {{first_name}}, what up', { username: 'x', fields: {} });
  assert.equal(r.text, 'Yo, what up');
  assert.deepEqual(r.missing, ['first_name']);
  assert.equal(spin('{a|{b|c}}', seq(0.9, 0.9)), 'c');
  assert.equal(spin('keep {this}'), 'keep {this}');
  assert.equal(renderOpener('hi\nthere', a).text, 'hi\nthere');
});

test('pickTemplate учитывает вес и выключенные', () => {
  const t = [{ id: 'a', text: 'A', weight: 1 }, { id: 'b', text: 'B', weight: 3 }, { id: 'c', text: 'C', enabled: false }];
  assert.equal(pickTemplate(t, () => 0.1).id, 'a');
  assert.equal(pickTemplate(t, () => 0.5).id, 'b');
  assert.equal(pickTemplate([{ text: '' }]), null);
});

test('DB: дубли, раздача по профилям без пересечений, возврат и лимиты', () => {
  const db = tmpDb();
  const list = Array.from({ length: 60 }, (_, i) => ({ username: `artist${i}`, name: `A ${i}`, fields: {} }));
  assert.equal(db.addArtists(list).added, 60);
  assert.equal(db.addArtists([{ username: 'artist1' }]).duplicates.length, 1);
  assert.ok(db.artists.every((a) => a.opener), 'опенеры собраны из шаблонов по умолчанию');

  const p1 = { id: '1', name: 'P1' }, p2 = { id: '2', name: 'P2' };
  const a1 = db.claimArtists(25, p1, 'r');
  const a2 = db.claimArtists(25, p2, 'r');
  assert.equal(a1.length, 25);
  assert.equal(a2.length, 25);
  assert.equal(new Set([...a1, ...a2].map((a) => a.username)).size, 50);

  db.markSent(a1[0].username, p1);
  db.markFailed(a1[1].username, 'x');
  db.markSkipped(a1[2].username, 'dialog exists');
  assert.equal(db.releaseQueued(a1.map((a) => a.username)), 22);
  assert.equal(db.sentTodayByProfile('1'), 1);
  assert.equal(db.stats().new, 10 + 22);

  // Перезапуск программы: «в работе» возвращаются в очередь, отправленные — нет
  const db2 = new DB(db.dir);
  assert.equal(db2.stats().queued, 0);
  assert.equal(db2.stats().sent, 1);

  db2.markProfileBlocked('2');
  assert.ok(db2.isProfileBlockedToday('2'));
  db2.unblockProfile('2');
  assert.ok(!db2.isProfileBlockedToday('2'));
});
