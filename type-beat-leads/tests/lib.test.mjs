import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyzeComment, classifyArtist, extractMentions, scorePost } from '../src/lib/classify.js';
import { IgError, assertPageUsable, cleanCommentText, ownerFromPost, parsePost, profileFromPage } from '../src/lib/instagram.js';
import { leadPriority } from '../src/lib/store.js';
import { extractJsonAfter, parseCount } from '../src/lib/util.js';
import {
  aggregateChannels,
  findInstagramHandles,
  parseChannelAbout,
  parseSearchResults,
  parseSubscribers,
  parseVideoDescription,
  videosFromScrape,
} from '../src/lib/youtube.js';

test('parseCount', () => {
  assert.equal(parseCount('1.2M subscribers'), 1200000);
  assert.equal(parseCount('12,476 views'), 12476);
  assert.equal(parseCount('31.2K'), 31200);
  assert.equal(parseCount('No views'), null);
  assert.equal(parseCount('3 Beats'), 3);
  assert.equal(parseCount('106 тыс.'), 106000);
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

test('profileFromPage: header text, meta, links', () => {
  const p = profileFromPage(
    {
      headerText: 'lilbuyer\nFollow\nMessage\n42 posts\n3,400 followers\n120 following\nLil Buyer\nMusician/band\nRapper 🎤 new single out now\nopen.spotify.com/artist/1',
      headerLinks: [{ href: 'https://l.instagram.com/?u=https%3A%2F%2Fopen.spotify.com%2Fartist%2F1&e=x', text: 'open.spotify.com/artist/1' }],
      verified: false,
    },
    'LilBuyer',
  );
  assert.equal(p.followers, 3400);
  assert.equal(p.postCount, 42);
  assert.equal(p.fullName, 'Lil Buyer');
  assert.match(p.bio, /Rapper/);
  assert.deepEqual(p.links, ['https://open.spotify.com/artist/1']);
  assert.ok(classifyArtist(p).isArtist);

  const ru = profileFromPage({ headerText: 'x\n18\nпубликаций\n106 тыс.\nподписчиков\n10 подписок\nИмя' }, 'x');
  assert.equal(ru.followers, 106000);
  assert.equal(ru.postCount, 18);

  const meta = profileFromPage({ headerText: '', metaDescription: '106K Followers, 3,497 Following, 18 Posts - See Instagram photos and videos from Pdubcookin (@pdubcookin)', ogTitle: 'Pdubcookin (@pdubcookin) • Instagram photos and videos' }, 'pdubcookin');
  assert.equal(meta.followers, 106000);
  assert.equal(meta.fullName, 'Pdubcookin');

  assert.equal(profileFromPage({ headerText: '' }, 'nobody'), null);
});

test('cleanCommentText strips UI noise', () => {
  assert.equal(cleanCommentText('buyer\n2w\nCheck DM, I’m trying to buy a beat\n3 likes\nReply\nSee translation', 'buyer'), 'Check DM, I’m trying to buy a beat');
  assert.equal(cleanCommentText('fan\n5 нед.\n🔥🔥🔥\nОтветить', 'fan'), '🔥🔥🔥');
  assert.equal(cleanCommentText('buyer\nHow much would it cost?\n2w 3 likes Reply', 'buyer'), 'How much would it cost?');
  assert.equal(cleanCommentText('a\nnew single out in 2w, who wants a feature?\n1d Reply', 'a'), 'new single out in 2w, who wants a feature?');
  assert.equal(cleanCommentText('a\nView replies (3)\nhit me up', 'a'), 'hit me up');
  assert.equal(cleanCommentText('b\nHow much?\n2wReply', 'b'), 'How much?');
  assert.equal(cleanCommentText('b\nСколько стоит?\n1 нед.Ответить', 'b'), 'Сколько стоит?');
});

test('parsePost: owner, caption mentions, comments', () => {
  const scrape = {
    metaDescription: '120 likes, 14 comments - prodalpha on May 1, 2026: "Out now w/ @placement_artist"',
    blocks: [
      { handle: 'prodalpha', text: 'prodalpha\n1w\nOut now w/ @placement_artist 🔥', mentions: ['@placement_artist'] },
      { handle: 'buyer', text: 'buyer\n2d\nhow much for this beat?\nReply', mentions: [] },
      { handle: 'buyer', text: 'buyer\n2d\nhow much for this beat?\nReply', mentions: [] },
      { handle: 'fan', text: 'fan\n2d\nReply', mentions: [] },
    ],
  };
  const post = parsePost(scrape);
  assert.equal(post.owner, 'prodalpha');
  assert.deepEqual(post.captionMentions, ['placement_artist']);
  assert.deepEqual(post.comments, [{ username: 'buyer', text: 'how much for this beat?' }]);
  assert.equal(ownerFromPost({ ownerHint: 'someone', blocks: [] }), 'someone');
});

test('assertPageUsable', () => {
  assert.throws(() => assertPageUsable({ loginWall: true }), (e) => e instanceof IgError && e.kind === 'login');
  assert.throws(() => assertPageUsable({ rateLimited: true }), (e) => e.kind === 'rate_limit');
  assert.doesNotThrow(() => assertPageUsable({}));
});

test('YouTube DOM search scrape → videos; subscriber text', () => {
  const videos = videosFromScrape({
    videos: [
      { videoId: 'a1', title: 'Rylo Type Beat', channelPath: '/@ProdStunnah', channelName: 'Stunnah', viewsText: '12K' },
      { videoId: 'b2', title: 'x', channelPath: '/channel/UCabc', channelName: 'Ch', viewsText: '1,234' },
      { videoId: 'c3', title: 'no channel', channelPath: null },
    ],
  });
  assert.equal(videos.length, 2);
  assert.equal(videos[0].views, 12000);
  assert.equal(videos[1].channelId, 'UCabc');
  assert.equal(aggregateChannels(videos).length, 1);
  assert.equal(parseSubscribers('@ProdStunnah•31.2K subscribers•500 videos'), 31200);
  assert.equal(parseSubscribers('2026\n31.2K subscribers'), 31200);
  assert.equal(parseSubscribers('203 тыс. подписчиков'), 203000);
});

test('lead priority', () => {
  const comment = { type: 'comment', intent: 6 };
  assert.equal(leadPriority({ isArtist: true, sources: [comment] }), 'hot');
  assert.equal(leadPriority({ isArtist: true, sources: [{ type: 'tagged' }] }), 'warm');
  assert.equal(leadPriority({ isArtist: false, sources: [comment] }), 'cold');
  assert.equal(leadPriority({ isArtist: null, sources: [{ type: 'tagged' }] }), 'unchecked');
});
