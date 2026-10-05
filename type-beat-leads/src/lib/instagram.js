// Instagram: URL внутренних web-API и нормализация ответов.
// Запросы выполняются из открытой вкладки instagram.com (с куками залогиненного пользователя).

import { extractMentions } from './classify.js';
import { safeJson } from './util.js';

const API = 'https://www.instagram.com/api/v1';

export const igUrls = {
  profilePage: (u) => `https://www.instagram.com/${u}/`,
  taggedPage: (u) => `https://www.instagram.com/${u}/tagged/`,
  postPage: (code) => `https://www.instagram.com/p/${code}/`,
  profileInfo: (u) => `${API}/users/web_profile_info/?username=${encodeURIComponent(u)}`,
  userFeed: (id, maxId) => `${API}/feed/user/${id}/?count=12${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''}`,
  // cursor — { param: 'min_id' | 'max_id', value } из normalizeComments.
  comments: (mediaId, cursor) =>
    `${API}/media/${mediaId}/comments/?can_support_threading=true&permalink_enabled=false${cursor ? `&${cursor.param}=${encodeURIComponent(cursor.value)}` : ''}`,
  tagged: (id, maxId) => `${API}/usertags/${id}/feed/?count=12${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''}`,
};

// Разбирает ответ fetch'а. Бросает типизированные ошибки, чтобы оркестратор мог решить: ждать, пропустить или остановиться.
export class IgError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'login' | 'rate_limit' | 'challenge' | 'not_found' | 'network' | 'bad_response'
  }
}

export function parseIgResponse(res) {
  if (!res || res.status === 0) throw new IgError('network', res?.error || 'нет ответа');
  if (res.url && /\/accounts\/login|\/challenge\//.test(res.url)) {
    throw new IgError(res.url.includes('challenge') ? 'challenge' : 'login', 'требуется вход в Instagram');
  }
  const json = safeJson(res.text);
  if (res.status === 429 || /please wait a few minutes/i.test(res.text || '')) {
    throw new IgError('rate_limit', 'Instagram ограничил запросы (429)');
  }
  if (json?.message === 'checkpoint_required' || json?.message === 'challenge_required') {
    throw new IgError('challenge', 'Instagram запросил проверку аккаунта (checkpoint)');
  }
  if (json?.require_login || res.status === 401 || json?.message === 'login_required') {
    throw new IgError('login', 'требуется вход в Instagram');
  }
  if (res.status === 404) throw new IgError('not_found', 'не найдено');
  if (!json) throw new IgError('bad_response', `неожиданный ответ (HTTP ${res.status})`);
  if (res.status >= 400) throw new IgError('bad_response', json.message || `HTTP ${res.status}`);
  return json;
}

export function normalizeProfile(json) {
  const u = json?.data?.user;
  if (!u) return null;
  const media = u.edge_owner_to_timeline_media || {};
  return {
    id: u.id,
    username: (u.username || '').toLowerCase(),
    fullName: u.full_name || '',
    bio: u.biography || '',
    category: u.category_name || u.business_category_name || '',
    externalUrl: u.external_url || '',
    links: (u.bio_links || []).map((l) => l.url || l.lynx_url).filter(Boolean),
    followers: u.edge_followed_by?.count ?? null,
    following: u.edge_follow?.count ?? null,
    postCount: media.count ?? null,
    isPrivate: !!u.is_private,
    isVerified: !!u.is_verified,
    isBusiness: !!u.is_business_account,
    // Первые ~12 постов приходят сразу — используем как фолбэк, если feed API недоступен.
    recentPosts: (media.edges || []).map(({ node: n }) => {
      const caption = n.edge_media_to_caption?.edges?.[0]?.node?.text || '';
      return {
        id: n.id,
        code: n.shortcode,
        caption,
        commentCount: n.edge_media_to_comment?.count ?? 0,
        isVideo: !!n.is_video,
        takenAt: n.taken_at_timestamp || null,
        mentions: extractMentions(caption),
        taggedUsers: (n.edge_media_to_tagged_user?.edges || []).map((e) => e.node?.user?.username?.toLowerCase()).filter(Boolean),
      };
    }),
  };
}

function normalizeFeedItem(it) {
  const caption = it.caption?.text || '';
  const tagged = (it.usertags?.in || []).map((t) => t.user?.username?.toLowerCase()).filter(Boolean);
  const coauthors = (it.coauthor_producers || []).map((c) => c.username?.toLowerCase()).filter(Boolean);
  return {
    id: String(it.pk || it.id || '').split('_')[0],
    code: it.code,
    caption,
    commentCount: it.comment_count ?? 0,
    isVideo: it.media_type === 2 || it.product_type === 'clips',
    takenAt: it.taken_at || null,
    owner: it.user?.username?.toLowerCase() || null,
    ownerFullName: it.user?.full_name || '',
    ownerVerified: !!it.user?.is_verified,
    mentions: extractMentions(caption),
    taggedUsers: [...new Set([...tagged, ...coauthors])],
  };
}

export function normalizeFeed(json) {
  return {
    items: (json?.items || []).map(normalizeFeedItem).filter((p) => p.id && p.code),
    nextMaxId: json?.more_available ? json.next_max_id : null,
  };
}

export function normalizeComments(json) {
  return {
    comments: (json?.comments || []).map((c) => ({
      id: String(c.pk || c.id),
      text: c.text || '',
      username: c.user?.username?.toLowerCase() || '',
      fullName: c.user?.full_name || '',
      isVerified: !!c.user?.is_verified,
      likes: c.comment_like_count || 0,
      createdAt: c.created_at || null,
    })),
    cursor: commentsCursor(json),
  };
}

function commentsCursor(json) {
  if (json?.next_min_id && (json.has_more_headload_comments || json.has_more_comments)) {
    return { param: 'min_id', value: json.next_min_id };
  }
  if (json?.next_max_id && json.has_more_comments !== false) {
    return { param: 'max_id', value: json.next_max_id };
  }
  return null;
}
