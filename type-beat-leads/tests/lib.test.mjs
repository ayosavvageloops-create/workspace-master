import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyzeComment, classifyArtist, extractMentions, scorePost } from '../src/lib/classify.js';
import { IgError, normalizeComments, normalizeFeed, normalizeProfile, parseIgResponse } from '../src/lib/instagram.js';
import { leadPriority } from '../src/lib/store.js';
import { extractJsonAfter, parseCount } from '../src/lib/util.js';
import {
  aggregateChannels,
  findInstagramHandles,
  parseChannelAbout,
  parseSearchResults,
  parseVideoDescription,
} from '../src/lib/youtube.js';

test('parseCount', () => {
  assert.equal(parseCount('1.2M subscribers'), 1200000);
  assert.equal(parseCount('12,476 views'), 12476);
  assert.equal(parseCount('31.2K'), 31200);
  assert.equal(parseCount('No views'), null);
});

test('extractJsonAfter handles braces inside strings', () => {
  const html = 'var ytInitialData = {"a":"}{\\"","b":{"c":[1,2]}};</script>';
  assert.deepEqual(extractJsonAfter(html, 'ytInitialData = '), { a: '}{"', b: { c: [1, 2] } });
});

test('buyer-intent comments score high', () => {
  for (const c of [
    'Check DM, I’m trying to buy a beat',
    'How much would it cost?',
    'Yo where can I buy this?',
    'is this beat still available??',
    'bro send me that beat 🔥',
  ]) {
    assert.ok(analyzeComment(c).score >= 4, c);
  }
});

test('"trying to buy" is recognised as purchase intent', () => {
  assert.ok(analyzeComment('Check DM, I’m trying to buy a beat').labels.includes('хочет купить'));
  assert.ok(analyzeComment('looking to cop this one').labels.includes('хочет купить'));
});

test('noise and producer spam score low', () => {
  for (const c of ['🔥🔥🔥', 'hard', 'this go crazy', 'check out my page for beats', 'I make beats too, follow back']) {
    assert.ok(analyzeComment(c).score < 4, c);
  }
});

test('artist vs producer classification', () => {
  const artist = classifyArtist({
    username: 'lilsomebody',
    fullName: 'Lil Somebody',
    bio: 'Rapper 🎤 new single OUT NOW\nbookings: mgmt@x.com',
    category: 'Musician/Band',
    externalUrl: 'https://open.spotify.com/artist/123',
    followers: 4200,
    postCount: 40,
  });
  assert.ok(artist.isArtist, artist.reasons.join(', '));
  assert.equal(artist.tier, 'small');

  const producer = classifyArtist({
    username: 'prodbyjay',
    bio: 'Producer | type beats | drum kits below',
    category: 'Music producer',
    externalUrl: 'https://www.beatstars.com/jay',
    followers: 9000,
    postCount: 300,
  });
  assert.ok(!producer.isArtist, producer.reasons.join(', '));
});

test('scorePost prefers beat/placement videos with comments', () => {
  const beat = { caption: 'new beat 🔥 link in bio', isVideo: true, commentCount: 50, mentions: [], taggedUsers: [] };
  const selfie = { caption: 'vibes', isVideo: false, commentCount: 50, mentions: [], taggedUsers: [] };
  assert.ok(scorePost(beat) > scorePost(selfie));
});

test('extractMentions', () => {
  assert.deepEqual(extractMentions('out now w/ @Rylo.Rodriguez and @someone.'), ['rylo.rodriguez', 'someone']);
});

test('findInstagramHandles: links, IG labels, typos', () => {
  assert.deepEqual(findInstagramHandles('https%3A%2F%2Finstagram.com%2Ftsunamisoslime'), ['tsunamisoslime']);
  assert.deepEqual(findInstagramHandles('📱 Instargam - @stunnahbeatz'), ['stunnahbeatz']);
  assert.deepEqual(findInstagramHandles('IG: @prod.jay.'), ['prod.jay']);
  assert.deepEqual(findInstagramHandles('https://www.instagram.com/p/ABC123/'), []);
});

test('YouTube search parsing and channel aggregation', () => {
  const videoRenderer = (id, title, channel, browseId, path, views) => ({
    videoRenderer: {
      videoId: id,
      title: { runs: [{ text: title }] },
      ownerText: { runs: [{ text: channel, navigationEndpoint: { browseEndpoint: { browseId, canonicalBaseUrl: path } } }] },
      viewCountText: { simpleText: `${views} views` },
    },
  });
  const data = {
    contents: [
      videoRenderer('a', 'Rylo Type Beat "Cold"', 'Stunnah', 'UC1', '/@ProdStunnah', '12,476'),
      videoRenderer('b', 'Rylo Type Beat "Warm"', 'Stunnah', 'UC1', '/@ProdStunnah', '1,000'),
      videoRenderer('c', 'Rylo Rodriguez - Song (Official Video)', 'Rylo Rodriguez - Topic', 'UC2', '/@x', '9,999,999'),
      { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'TOKEN' } } } },
    ],
  };
  const { videos, continuation } = parseSearchResults(data);
  assert.equal(videos.length, 3);
  assert.equal(continuation, 'TOKEN');
  const channels = aggregateChannels(videos);
  assert.equal(channels.length, 1);
  assert.equal(channels[0].totalViews, 13476);
  assert.equal(channels[0].url, 'https://www.youtube.com/@ProdStunnah');
});

test('parseChannelAbout / parseVideoDescription', () => {
  const data = {
    metadata: { channelMetadataRenderer: { description: 'Beats for sale\nIG: @stunnahbeatz' } },
    header: { pageHeaderViewModel: { metadata: { content: '31.2K subscribers' } } },
  };
  const html = `<script>var ytInitialData = ${JSON.stringify(data)};</script>"31.2K subscribers"`;
  assert.deepEqual(parseChannelAbout(html), { subscribers: 31200, handles: ['stunnahbeatz'] });
  const watch = `"shortDescription":"Buy: https://bsta.rs/x\\nInstagram: @jaybeats","isCrawlable"`;
  assert.deepEqual(findInstagramHandles(parseVideoDescription(watch)), ['jaybeats']);
});

test('Instagram response parsing and errors', () => {
  assert.throws(() => parseIgResponse({ status: 429, text: '{"message":"Please wait a few minutes"}' }), (e) => e instanceof IgError && e.kind === 'rate_limit');
  assert.throws(() => parseIgResponse({ status: 200, url: 'https://www.instagram.com/accounts/login/', text: '<html>' }), (e) => e.kind === 'login');
  assert.throws(() => parseIgResponse({ status: 400, text: '{"message":"checkpoint_required"}' }), (e) => e.kind === 'challenge');

  const profile = normalizeProfile({
    data: {
      user: {
        id: '42', username: 'Artist', full_name: 'A', biography: 'rapper', category_name: 'Artist',
        bio_links: [{ url: 'https://open.spotify.com/x' }], edge_followed_by: { count: 1500 },
        edge_owner_to_timeline_media: {
          count: 1,
          edges: [{ node: { id: '1', shortcode: 'C1', is_video: true, edge_media_to_comment: { count: 3 }, edge_media_to_caption: { edges: [{ node: { text: 'w/ @prod' } }] } } }],
        },
      },
    },
  });
  assert.equal(profile.username, 'artist');
  assert.equal(profile.followers, 1500);
  assert.deepEqual(profile.recentPosts[0].mentions, ['prod']);

  const feed = normalizeFeed({
    items: [{ pk: '99', code: 'XYZ', media_type: 2, comment_count: 7, caption: { text: 'new beat' }, user: { username: 'Owner' }, usertags: { in: [{ user: { username: 'Tagged1' } }] } }],
    more_available: true,
    next_max_id: 'next',
  });
  assert.equal(feed.items[0].owner, 'owner');
  assert.deepEqual(feed.items[0].taggedUsers, ['tagged1']);
  assert.equal(feed.nextMaxId, 'next');

  const comments = normalizeComments({
    comments: [{ pk: 1, text: 'how much?', user: { username: 'Buyer' } }],
    has_more_headload_comments: true,
    next_min_id: '{"cursor":1}',
  });
  assert.equal(comments.comments[0].username, 'buyer');
  assert.deepEqual(comments.cursor, { param: 'min_id', value: '{"cursor":1}' });
});

test('lead priority', () => {
  const comment = { type: 'comment', intent: 6 };
  assert.equal(leadPriority({ isArtist: true, sources: [comment] }), 'hot');
  assert.equal(leadPriority({ isArtist: true, sources: [{ type: 'tagged' }] }), 'warm');
  assert.equal(leadPriority({ isArtist: false, sources: [comment] }), 'cold');
  assert.equal(leadPriority({ isArtist: null, sources: [{ type: 'tagged' }] }), 'unchecked');
});
