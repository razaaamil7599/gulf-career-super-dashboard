'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Meta App under review: "Gulf Career Messenger"
const FB_APP_ID = '1471622987996460';
const GRAPH_VERSION = 'v21.0';
const REQUESTED_SCOPES = [
  'public_profile',
  'pages_show_list',
  'pages_manage_metadata',
  'pages_messaging',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
  'instagram_basic',
  'instagram_manage_messages',
  'ads_management',
  'ads_read',
].join(',');

type LoginStatus = 'idle' | 'logged_in' | 'error';
type Channel = 'messenger' | 'instagram';

interface PageAsset {
  id: string;
  name: string;
  category?: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
}

interface ConversationParticipant {
  id?: string;
  name?: string;
  username?: string;
}

interface Conversation {
  id: string;
  snippet?: string;
  updated_time?: string;
  participants?: { data: ConversationParticipant[] };
}

interface ThreadMessage {
  id: string;
  message: string;
  from: string;
  created_time?: string;
}

interface PagePost {
  id: string;
  message: string;
  created_time: string;
  thumbnail?: string;
}

interface AdAccount {
  id: string;
  name: string;
  account_status?: number;
  currency?: string;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  objective?: string;
}

interface WebhookEvent {
  id: string;
  type: string;
  summary: string;
  senderName: string;
  timestamp: string;
}

interface ActiveThread {
  channel: Channel;
  conversationId: string;
  recipientId: string;
  recipientLabel: string;
}

// Best-effort redaction so an access token can never end up rendered in the
// on-page activity log, whatever produced the log line (Graph API error
// text, a thrown Error's message, etc).
function redact(text: string): string {
  return String(text)
    .replace(/access_token=[^&\s"]+/gi, 'access_token=[redacted]')
    .replace(/\bEAA[A-Za-z0-9]{15,}/g, '[redacted-token]');
}

function readTokenFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  if (!window.location.hash.includes('access_token')) return null;
  const hashParams = new URLSearchParams(window.location.hash.substring(1));
  return hashParams.get('access_token');
}

// Renders a Graph API error's full useful detail (message + type + code +
// subcode), not just .message, so a failure shown in the Activity log is
// enough to diagnose without needing Graph API Explorer on the side.
function describeGraphError(e: any): string {
  if (!e) return 'unknown error';
  if (typeof e === 'string') return e;
  const parts = [
    e.message,
    e.type,
    e.code != null ? `code ${e.code}` : null,
    e.error_subcode != null ? `subcode ${e.error_subcode}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' | ') : JSON.stringify(e);
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function MetaDemoPage() {
  const [accessToken, setAccessToken] = useState<string | null>(() => readTokenFromHash());
  const [status, setStatus] = useState<LoginStatus>(() => (readTokenFromHash() ? 'logged_in' : 'idle'));
  const [errorMsg, setErrorMsg] = useState('');
  const [userProfile, setUserProfile] = useState<{ name: string; picture?: string } | null>(null);
  const [pages, setPages] = useState<PageAsset[]>([]);
  const [selectedPage, setSelectedPage] = useState<PageAsset | null>(null);
  const [pageMessages, setPageMessages] = useState<Conversation[]>([]);
  const [igMessages, setIgMessages] = useState<Conversation[]>([]);
  const [businessAssets, setBusinessAssets] = useState<any[]>([]);
  const [log, setLog] = useState<string[]>([]);

  // Chat history backfill — imports full Messenger + Instagram DM history via
  // the server's own stored Page token, so it works independent of this
  // browser session.
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Page posts & engagement (pages_read_engagement)
  const [pagePosts, setPagePosts] = useState<PagePost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);

  // Post management (pages_manage_posts)
  const [newPostText, setNewPostText] = useState('');
  const [creatingPost, setCreatingPost] = useState(false);
  const [createPostResult, setCreatePostResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);

  // Ads (ads_management / ads_read)
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([]);
  const [selectedAdAccount, setSelectedAdAccount] = useState<AdAccount | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adAccountsLoading, setAdAccountsLoading] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [createCampaignResult, setCreateCampaignResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Webhook subscriptions (pages_manage_metadata)
  const [subscribedFields, setSubscribedFields] = useState<string[] | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [subscribeResult, setSubscribeResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [webhookEvents, setWebhookEvents] = useState<WebhookEvent[]>([]);
  const lastEventIdRef = useRef<string>('');

  // Open conversation thread + reply (pages_messaging / instagram_manage_messages)
  const [activeThread, setActiveThread] = useState<ActiveThread | null>(null);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [draftText, setDraftText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);

  const addLog = useCallback((line: string) => {
    setLog((prev) => [...prev, `${new Date().toLocaleTimeString()} — ${redact(line)}`]);
  }, []);

  const fb = useCallback(async (path: string, params: Record<string, string> = {}, token?: string) => {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}${path}`);
    const finalParams = { ...params, access_token: token || accessToken || '' };
    Object.entries(finalParams).forEach(([key, value]) => url.searchParams.set(key, value));
    const res = await fetch(url.toString());
    const json = await res.json();
    if (json.error) throw json.error;
    return json;
  }, [accessToken]);

  const fbPost = useCallback(async (path: string, params: Record<string, string>, token?: string) => {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}${path}`);
    url.searchParams.set('access_token', token || accessToken || '');
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const json = await res.json();
    if (json.error) throw json.error;
    return json;
  }, [accessToken]);

  // Page-scoped Graph API calls (posts, subscribed_apps, conversations,
  // messages) require a Page access token, never the User token — Pages on
  // Meta's "New Pages Experience" reject a User token for these with error
  // 190/2069032. fb()/fbPost() silently fall back to the User token if the
  // page token passed in is missing, which masks that failure mode behind a
  // confusing Graph API error. These wrappers fail loudly and immediately
  // instead, so a missing Page token is obvious from the Activity log.
  const fbPage = useCallback(async (path: string, params: Record<string, string>, page: PageAsset) => {
    if (!page.access_token) {
      throw { message: `No Page access token available for "${page.name}" — cannot call ${path} with a User token. This Page may be on Meta's New Pages Experience; check that it was selected in the Business Asset picker during login.` };
    }
    return fb(path, params, page.access_token);
  }, [fb]);

  const fbPagePost = useCallback(async (path: string, params: Record<string, string>, page: PageAsset) => {
    if (!page.access_token) {
      throw { message: `No Page access token available for "${page.name}" — cannot call ${path} with a User token. This Page may be on Meta's New Pages Experience; check that it was selected in the Business Asset picker during login.` };
    }
    return fbPost(path, params, page.access_token);
  }, [fbPost]);

  const loadAdAccounts = useCallback(async (token: string) => {
    setAdAccountsLoading(true);
    try {
      const res = await fb('/me/adaccounts', { fields: 'name,account_status,currency' }, token);
      const accounts: AdAccount[] = res.data || [];
      setAdAccounts(accounts);
      addLog(`ads_read: found ${accounts.length} ad account(s) this user can access.`);
    } catch (e: any) {
      setAdAccounts([]);
      addLog(`ads_read: could not load ad accounts — ${describeGraphError(e)}.`);
    } finally {
      setAdAccountsLoading(false);
    }
  }, [fb, addLog]);

  const loadEverything = useCallback(async (token: string) => {
    try {
      const me = await fb('/me', { fields: 'name,picture' }, token);
      setUserProfile({ name: me.name, picture: me.picture?.data?.url });
      addLog(`public_profile: logged in as "${me.name}".`);

      const accounts = await fb('/me/accounts', { fields: 'name,category,access_token,instagram_business_account{id,username,profile_picture_url}' }, token);
      const pageList: PageAsset[] = accounts.data || [];
      setPages(pageList);
      addLog(`pages_show_list: found ${pageList.length} Facebook Page(s) this user manages.`);
      pageList.filter((p) => !p.access_token).forEach((p) => {
        addLog(`Warning: "${p.name}" came back from /me/accounts with no Page access token. Page-scoped sections (posts, webhooks, messaging) will fail for it until this is resolved on Meta's side.`);
      });

      try {
        const biz = await fb('/me/businesses', { fields: 'name,id' }, token);
        setBusinessAssets(biz.data || []);
        addLog(`business_management: found ${biz.data?.length || 0} Business Manager asset(s).`);
      } catch (e: any) {
        addLog(`business_management: no Business Manager assets visible for this user (${e?.message || 'n/a'}).`);
      }

      await loadAdAccounts(token);
    } catch (e: any) {
      addLog(`Error while loading account data: ${e?.message || e}`);
      setErrorMsg(e?.message || 'Failed to load account data.');
    }
  }, [fb, addLog, loadAdAccounts]);

  async function runChatHistoryBackfill() {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await fetch('/api/messages/backfill-meta-chats', { method: 'POST' });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      const s = json.stats;
      addLog(`Chat history backfill: ${s.conversationsFound} conversation(s) scanned, ${s.messagesImported} message(s) imported, ${s.candidatesCreated} new contact(s) added.`);
      setBackfillResult({
        ok: true,
        message: `Done: ${s.conversationsFound} conversations scanned, ${s.messagesImported} messages imported, ${s.candidatesCreated} new contacts.${s.conversationErrors ? ` (${s.conversationErrors} conversation(s) failed — see Activity log.)` : ''}`,
      });
    } catch (e: any) {
      addLog(`Chat history backfill failed: ${e?.message || e}.`);
      setBackfillResult({ ok: false, message: e?.message || 'Backfill failed.' });
    } finally {
      setBackfilling(false);
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash.includes('access_token')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    if (accessToken) {
      addLog('User granted access — access token received.');
      loadEverything(accessToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLogin() {
    setErrorMsg('');
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const params = new URLSearchParams({
      client_id: FB_APP_ID,
      redirect_uri: redirectUri,
      scope: REQUESTED_SCOPES,
      response_type: 'token',
      auth_type: 'rerequest',
    });
    addLog(`Redirecting to Facebook login with scopes: ${REQUESTED_SCOPES}`);
    window.location.href = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
  }

  const loadPagePosts = useCallback(async (page: PageAsset) => {
    setPostsLoading(true);
    try {
      // Deliberately minimal: message/created_time/full_picture is all a
      // reviewer needs to see (text, date, thumbnail). Engagement aggregate
      // edges (likes.summary(true), comments.summary(true)) were tried here
      // and threw (#10) even with pages_read_engagement granted and a valid
      // Page token — confirmed via Graph API Explorer that the plain fields
      // succeed on their own, so the aggregate edges are dropped for good
      // rather than re-adding a call path that's proven to fail.
      const res = await fbPage(
        `/${page.id}/posts`,
        { fields: 'message,created_time,full_picture', limit: '10' },
        page
      );
      const posts: PagePost[] = (res.data || []).map((p: any) => ({
        id: p.id,
        message: p.message || '(no text)',
        created_time: p.created_time,
        thumbnail: p.full_picture,
      }));
      setPagePosts(posts);
      addLog(`pages_read_engagement: found ${posts.length} recent post(s) on "${page.name}".`);
    } catch (e: any) {
      setPagePosts([]);
      addLog(`pages_read_engagement: could not load posts for "${page.name}" — ${describeGraphError(e)}.`);
    } finally {
      setPostsLoading(false);
    }
  }, [fbPage, addLog]);

  async function createPost() {
    if (!selectedPage || !newPostText.trim()) return;
    setCreatingPost(true);
    setCreatePostResult(null);
    try {
      const res = await fbPagePost(`/${selectedPage.id}/feed`, { message: newPostText.trim() }, selectedPage);
      addLog(`pages_manage_posts: created a new post on "${selectedPage.name}" (id ${res.id}).`);
      setCreatePostResult({ ok: true, message: 'Post published.' });
      setNewPostText('');
      await loadPagePosts(selectedPage);
    } catch (e: any) {
      addLog(`pages_manage_posts: create post failed — ${describeGraphError(e)}.`);
      setCreatePostResult({ ok: false, message: describeGraphError(e) });
    } finally {
      setCreatingPost(false);
    }
  }

  async function deletePost(postId: string) {
    if (!selectedPage) return;
    setDeletingPostId(postId);
    try {
      const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${postId}`);
      url.searchParams.set('access_token', selectedPage.access_token);
      const res = await fetch(url.toString(), { method: 'DELETE' });
      const json = await res.json();
      if (json.error) throw json.error;
      addLog(`pages_manage_posts: deleted post ${postId} on "${selectedPage.name}".`);
      setPagePosts((prev) => prev.filter((p) => p.id !== postId));
    } catch (e: any) {
      addLog(`pages_manage_posts: delete post failed — ${describeGraphError(e)}.`);
    } finally {
      setDeletingPostId(null);
    }
  }

  async function selectAdAccount(account: AdAccount) {
    setSelectedAdAccount(account);
    setCampaigns([]);
    setCreateCampaignResult(null);
    try {
      const res = await fb(`/${account.id}/campaigns`, { fields: 'name,status,objective', limit: '15' });
      setCampaigns(res.data || []);
      addLog(`ads_read: found ${res.data?.length || 0} campaign(s) in "${account.name}".`);
    } catch (e: any) {
      addLog(`ads_read: could not load campaigns for "${account.name}" — ${describeGraphError(e)}.`);
    }
  }

  async function createCampaign() {
    if (!selectedAdAccount || !newCampaignName.trim()) return;
    setCreatingCampaign(true);
    setCreateCampaignResult(null);
    try {
      // Created PAUSED, on purpose — this demonstrates ads_management (a real
      // write call to the Marketing API) with zero spend risk. Launching a
      // real, budgeted, targeted campaign is a separate task once the
      // permission itself is approved.
      const res = await fbPost(`/${selectedAdAccount.id}/campaigns`, {
        name: newCampaignName.trim(),
        objective: 'OUTCOME_ENGAGEMENT',
        status: 'PAUSED',
        special_ad_categories: '[]',
      });
      addLog(`ads_management: created campaign "${newCampaignName.trim()}" (id ${res.id}, status PAUSED) in "${selectedAdAccount.name}".`);
      setCreateCampaignResult({ ok: true, message: 'Campaign created (paused, no spend).' });
      setNewCampaignName('');
      await selectAdAccount(selectedAdAccount);
    } catch (e: any) {
      addLog(`ads_management: create campaign failed — ${describeGraphError(e)}.`);
      setCreateCampaignResult({ ok: false, message: describeGraphError(e) });
    } finally {
      setCreatingCampaign(false);
    }
  }

  const loadSubscribedFields = useCallback(async (page: PageAsset) => {
    try {
      const res = await fbPage(`/${page.id}/subscribed_apps`, {}, page);
      const app = (res.data || [])[0];
      setSubscribedFields(app?.subscribed_fields || []);
    } catch (e: any) {
      setSubscribedFields([]);
      addLog(`pages_manage_metadata: could not read current webhook subscription — ${describeGraphError(e)}.`);
    }
  }, [fbPage, addLog]);

  async function subscribeWebhooks() {
    if (!selectedPage) return;
    setSubscribing(true);
    setSubscribeResult(null);
    try {
      const res = await fbPagePost(`/${selectedPage.id}/subscribed_apps`, { subscribed_fields: 'messages,feed' }, selectedPage);
      addLog(`pages_manage_metadata: subscribe response for "${selectedPage.name}": ${JSON.stringify(res)}.`);
      setSubscribeResult({ ok: true, message: 'Subscribed successfully.' });
    } catch (e: any) {
      addLog(`pages_manage_metadata: subscribe failed for "${selectedPage.name}" — ${describeGraphError(e)}.`);
      setSubscribeResult({ ok: false, message: describeGraphError(e) });
    } finally {
      // Always re-read the real subscription state, success or failure, so
      // "Currently subscribed fields" never shows stale data that looks
      // like it reflects this attempt when it doesn't (bug #4).
      await loadSubscribedFields(selectedPage);
      setSubscribing(false);
    }
  }

  async function openThread(conv: Conversation, channel: Channel) {
    if (!selectedPage) return;
    setSendResult(null);
    setDraftText('');
    try {
      const res = await fbPage(`/${conv.id}`, { fields: 'messages{message,from,created_time,id}' }, selectedPage);
      const raw = res.messages?.data || [];
      setThreadMessages(
        raw
          .slice()
          .reverse()
          .map((m: any) => ({ id: m.id, message: m.message || '(no text)', from: m.from?.name || m.from?.username || 'Contact', created_time: m.created_time }))
      );

      const selfId = channel === 'instagram' ? selectedPage.instagram_business_account?.id : selectedPage.id;
      const other = conv.participants?.data?.find((p) => p.id && p.id !== selfId);
      const recipientLabel = other?.username || other?.name || 'contact';
      setActiveThread({ channel, conversationId: conv.id, recipientId: other?.id || '', recipientLabel });

      const permission = channel === 'instagram' ? 'instagram_manage_messages' : 'pages_messaging';
      addLog(`${permission}: opened thread with "${recipientLabel}".`);
    } catch (e: any) {
      addLog(`Could not open conversation thread (${e?.message || 'unknown error'}).`);
    }
  }

  async function sendMessage() {
    if (!activeThread || !selectedPage || !draftText.trim() || !activeThread.recipientId) return;
    const text = draftText.trim();
    setSending(true);
    setSendResult(null);
    try {
      await fbPagePost(
        `/${selectedPage.id}/messages`,
        {
          recipient: JSON.stringify({ id: activeThread.recipientId }),
          message: JSON.stringify({ text }),
          messaging_type: 'RESPONSE',
        },
        selectedPage
      );
      const permission = activeThread.channel === 'instagram' ? 'instagram_manage_messages' : 'pages_messaging';
      const label = activeThread.channel === 'instagram' ? 'Instagram DM' : 'Messenger';
      addLog(`${permission}: sent a ${label} reply to "${activeThread.recipientLabel}".`);
      setThreadMessages((prev) => [...prev, { id: `local-${Date.now()}`, message: text, from: selectedPage.name, created_time: new Date().toISOString() }]);
      setDraftText('');
      setSendResult({ ok: true, message: 'Message sent.' });
    } catch (e: any) {
      addLog(`Send failed: ${e?.message || 'unknown error'}.`);
      setSendResult({ ok: false, message: e?.message || 'Send failed.' });
    } finally {
      setSending(false);
    }
  }

  async function inspectPage(page: PageAsset) {
    setSelectedPage(page);
    setPageMessages([]);
    setIgMessages([]);
    setPagePosts([]);
    setSubscribedFields(null);
    setSubscribeResult(null);
    setWebhookEvents([]);
    setActiveThread(null);
    setThreadMessages([]);
    lastEventIdRef.current = '';
    addLog(`Selected Page: "${page.name}" (${page.id}). Reloading every section for this Page...`);

    try {
      const conv = await fbPage(`/${page.id}/conversations`, { fields: 'snippet,updated_time,participants{id,name,username}' }, page);
      setPageMessages(conv.data || []);
      addLog(`pages_messaging: found ${conv.data?.length || 0} Messenger conversation(s) for "${page.name}".`);
    } catch (e: any) {
      addLog(`pages_messaging: could not load Messenger conversations (${e?.message || 'no conversations yet'}).`);
    }

    if (page.instagram_business_account?.id) {
      addLog(`instagram_basic: connected Instagram account is @${page.instagram_business_account.username}.`);
      try {
        const igConv = await fbPage(`/${page.id}/conversations`, { platform: 'instagram', fields: 'updated_time,participants{id,name,username}' }, page);
        setIgMessages(igConv.data || []);
        addLog(`instagram_manage_messages: found ${igConv.data?.length || 0} Instagram DM conversation(s).`);
      } catch (e: any) {
        addLog(`instagram_manage_messages: could not load Instagram conversations (${e?.message || 'no conversations yet'}).`);
      }
    } else {
      addLog('This Page has no linked Instagram professional account, so Instagram permissions cannot be demonstrated for it.');
    }

    await loadPagePosts(page);
    await loadSubscribedFields(page);
  }

  // Poll for new webhook events (messages + feed/comments) on the selected
  // Page while it stays selected. Polling, not SSE — simplest reliable
  // option for a reviewer-facing demo page.
  useEffect(() => {
    if (!selectedPage) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const qs = new URLSearchParams({ pageId: selectedPage.id });
        if (lastEventIdRef.current) qs.set('sinceId', lastEventIdRef.current);
        const res = await fetch(`/api/meta-demo/events?${qs.toString()}`);
        const json = await res.json();
        if (cancelled || !json.events?.length) return;
        setWebhookEvents((prev) => [...prev, ...json.events].slice(-30));
        lastEventIdRef.current = json.events[json.events.length - 1].id;
      } catch {
        // Silent — this is a background poll, not a user-triggered action.
      }
    };

    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedPage]);

  const sectionHint = (text: string) => (
    <p style={{ color: '#5B6770', fontSize: 11, marginTop: 6, marginBottom: 0 }}>{text}</p>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0B141A', color: '#E9EDEF', fontFamily: 'Segoe UI, Arial, sans-serif', padding: '32px 24px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>Gulf Career Messenger — Permission Demo</h1>
        <p style={{ color: '#8696A0', fontSize: 14, marginBottom: 24 }}>
          This page demonstrates, end-to-end, how Gulf Career Messenger uses each requested Meta permission:
          logging in with Facebook, granting access, and then reading and acting on the Facebook Pages, Instagram
          account, and message threads that permission unlocks.
        </p>

        {status !== 'logged_in' && (
          <button
            onClick={handleLogin}
            style={{
              background: '#1877F2',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '12px 20px',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {status === 'error' ? 'Try Facebook Login again' : 'Continue with Facebook'}
          </button>
        )}

        {errorMsg && (
          <div style={{ marginTop: 12, color: '#F87171', fontSize: 13 }}>{errorMsg}</div>
        )}

        {status === 'logged_in' && userProfile && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              {userProfile.picture && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={userProfile.picture} alt="" width={48} height={48} style={{ borderRadius: 24 }} />
              )}
              <div>
                <div style={{ fontWeight: 600 }}>Logged in as {userProfile.name}</div>
                <div style={{ fontSize: 12, color: '#8696A0' }}>Permission: public_profile</div>
              </div>
            </div>

            <div style={{ background: '#1A2830', border: '1px solid #2A3942', borderRadius: 8, padding: 14, marginBottom: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Recover full chat history</div>
              <div style={{ fontSize: 12, color: '#8696A0', marginBottom: 10 }}>
                Imports every past Messenger and Instagram DM conversation for the connected Page into the dashboard,
                so chats that happened before the bot was fully connected aren't missed. Safe to run more than once.
              </div>
              <button
                onClick={runChatHistoryBackfill}
                disabled={backfilling}
                style={{
                  background: '#1877F2',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '9px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: backfilling ? 'default' : 'pointer',
                  opacity: backfilling ? 0.7 : 1,
                }}
              >
                {backfilling ? 'Recovering chats…' : 'Recover all past chats now'}
              </button>
              {backfillResult && (
                <div style={{ marginTop: 8, fontSize: 12, color: backfillResult.ok ? '#4ADE80' : '#F87171' }}>{backfillResult.message}</div>
              )}
            </div>

            <h2 style={{ fontSize: 16, marginBottom: 8 }}>Your Facebook Pages (pages_show_list)</h2>
            {pages.length === 0 && <p style={{ color: '#8696A0', fontSize: 13 }}>No Pages found for this account yet.</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
              {pages.map((p) => (
                <button
                  key={p.id}
                  onClick={() => inspectPage(p)}
                  style={{
                    textAlign: 'left',
                    background: selectedPage?.id === p.id ? '#1F2C34' : '#1A2830',
                    border: '1px solid #2A3942',
                    borderRadius: 8,
                    padding: '10px 14px',
                    color: '#E9EDEF',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: '#8696A0' }}>
                    {p.category || 'Page'}
                    {p.instagram_business_account ? ` · Instagram: @${p.instagram_business_account.username}` : ' · No linked Instagram account'}
                  </div>
                </button>
              ))}
            </div>
            {sectionHint('Lists every Facebook Page this logged-in user administers, using the pages_show_list permission. Selecting a Page reloads every section below for that Page.')}

            {selectedPage && (
              <>
                {/* ---- Page posts & engagement (pages_read_engagement) ---- */}
                <h2 style={{ fontSize: 16, marginTop: 24, marginBottom: 2 }}>Page posts &amp; engagement (pages_read_engagement)</h2>
                <div style={{ fontSize: 12, color: '#8696A0', marginBottom: 8 }}>
                  Page: {selectedPage.name} &middot; Page ID: {selectedPage.id}
                </div>
                {postsLoading && <p style={{ color: '#8696A0', fontSize: 13 }}>Loading posts…</p>}
                {!postsLoading && pagePosts.length === 0 && <p style={{ color: '#8696A0', fontSize: 13 }}>No recent posts found for this Page.</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 0 }}>
                  {pagePosts.map((post) => (
                    <div key={post.id} style={{ display: 'flex', gap: 10, background: '#1A2830', border: '1px solid #2A3942', borderRadius: 8, padding: 10, alignItems: 'flex-start' }}>
                      {post.thumbnail && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={post.thumbnail} alt="" width={56} height={56} style={{ borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, color: '#D1D7DB' }}>{post.message}</div>
                        <div style={{ fontSize: 11, color: '#8696A0', marginTop: 4 }}>
                          {formatDate(post.created_time)}
                        </div>
                      </div>
                      <button
                        onClick={() => deletePost(post.id)}
                        disabled={deletingPostId === post.id}
                        style={{
                          background: 'transparent',
                          color: '#F87171',
                          border: '1px solid #3A2A2A',
                          borderRadius: 6,
                          padding: '4px 10px',
                          fontSize: 11,
                          cursor: deletingPostId === post.id ? 'default' : 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        {deletingPostId === post.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  ))}
                </div>
                {sectionHint('Fetches GET /{page-id}/posts for the selected Page and renders each post\'s text, date, and thumbnail, demonstrating pages_read_engagement.')}

                {/* ---- Post management (pages_manage_posts) ---- */}
                <h2 style={{ fontSize: 16, marginTop: 24, marginBottom: 2 }}>Create a Page post (pages_manage_posts)</h2>
                <div style={{ fontSize: 12, color: '#8696A0', marginBottom: 8 }}>Page: {selectedPage.name}</div>
                <textarea
                  value={newPostText}
                  onChange={(e) => setNewPostText(e.target.value)}
                  placeholder="Write a real post to publish on this Page…"
                  rows={3}
                  style={{
                    width: '100%',
                    background: '#1A2830',
                    border: '1px solid #2A3942',
                    borderRadius: 6,
                    padding: '8px 10px',
                    color: '#E9EDEF',
                    fontSize: 13,
                    resize: 'vertical',
                  }}
                />
                <button
                  onClick={createPost}
                  disabled={creatingPost || !newPostText.trim()}
                  style={{
                    marginTop: 8,
                    background: '#1877F2',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '9px 16px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: creatingPost ? 'default' : 'pointer',
                    opacity: creatingPost || !newPostText.trim() ? 0.7 : 1,
                  }}
                >
                  {creatingPost ? 'Publishing…' : 'Publish post'}
                </button>
                {createPostResult && (
                  <div style={{ marginTop: 8, fontSize: 12, color: createPostResult.ok ? '#4ADE80' : '#F87171' }}>{createPostResult.message}</div>
                )}
                {sectionHint('Publishes a real post via POST /{page-id}/feed and deletes via DELETE /{post-id} (Delete button above), demonstrating pages_manage_posts.')}

                {/* ---- Webhook subscriptions (pages_manage_metadata) ---- */}
                <h2 style={{ fontSize: 16, marginTop: 24, marginBottom: 2 }}>Webhook subscriptions (pages_manage_metadata)</h2>
                <div style={{ fontSize: 12, color: '#8696A0', marginBottom: 8 }}>
                  Page: {selectedPage.name} &middot; Page ID: {selectedPage.id}
                </div>
                <button
                  onClick={subscribeWebhooks}
                  disabled={subscribing}
                  style={{
                    background: '#1877F2',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '9px 16px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: subscribing ? 'default' : 'pointer',
                    opacity: subscribing ? 0.7 : 1,
                  }}
                >
                  {subscribing ? 'Subscribing…' : 'Subscribe this Page to webhooks'}
                </button>
                {subscribeResult && (
                  <div style={{ marginTop: 8, fontSize: 12, color: subscribeResult.ok ? '#4ADE80' : '#F87171' }}>{subscribeResult.message}</div>
                )}
                <div style={{ marginTop: 10, fontSize: 12, color: '#8696A0' }}>
                  Currently subscribed fields: {subscribedFields === null ? 'checking…' : subscribedFields.length ? subscribedFields.join(', ') : 'none yet'}
                </div>

                <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600 }}>Incoming webhook events</div>
                <div style={{ background: '#111B21', border: '1px solid #2A3942', borderRadius: 8, padding: 12, fontSize: 12, color: '#D1D7DB', maxHeight: 160, overflowY: 'auto', marginTop: 6 }}>
                  {webhookEvents.length === 0 ? (
                    <div style={{ color: '#8696A0' }}>Waiting for a message or comment on this Page…</div>
                  ) : (
                    webhookEvents.map((ev) => (
                      <div key={ev.id} style={{ marginBottom: 4 }}>
                        <span style={{ color: '#8696A0' }}>{formatDate(ev.timestamp)}</span> — [{ev.type}] {ev.senderName}: {ev.summary}
                      </div>
                    ))
                  )}
                </div>
                {sectionHint('Subscribes the Page to the "messages" and "feed" webhook fields via POST /{page-id}/subscribed_apps, then polls GET /api/meta-demo/events every few seconds so any real inbound message or Page comment appears here live, demonstrating pages_manage_metadata.')}

                {/* ---- Messenger conversations (pages_messaging) ---- */}
                <h2 style={{ fontSize: 16, marginTop: 24, marginBottom: 2 }}>Messenger conversations (pages_messaging)</h2>
                <div style={{ fontSize: 12, color: '#8696A0', marginBottom: 8 }}>Page: {selectedPage.name}</div>
                {pageMessages.length === 0 && <p style={{ color: '#8696A0', fontSize: 13 }}>No Messenger conversations found for this Page.</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 0 }}>
                  {pageMessages.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => openThread(c, 'messenger')}
                      style={{
                        textAlign: 'left',
                        background: activeThread?.conversationId === c.id ? '#1F2C34' : '#1A2830',
                        border: '1px solid #2A3942',
                        borderRadius: 8,
                        padding: '8px 12px',
                        color: '#D1D7DB',
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      {c.participants?.data?.map((p) => p.name).join(', ') || 'Conversation'} — {c.snippet || '(no preview)'}
                    </button>
                  ))}
                </div>
                {activeThread?.channel === 'messenger' && (
                  <ThreadPanel
                    thread={activeThread}
                    messages={threadMessages}
                    draftText={draftText}
                    onDraftChange={setDraftText}
                    onSend={sendMessage}
                    sending={sending}
                    sendResult={sendResult}
                  />
                )}
                {sectionHint('Lists this Page\'s Messenger conversations via GET /{page-id}/conversations. Opening one loads its thread; Send posts a real reply via POST /{page-id}/messages, demonstrating pages_messaging.')}

                {/* ---- Instagram DM conversations (instagram_manage_messages) ---- */}
                <h2 style={{ fontSize: 16, marginTop: 24, marginBottom: 2 }}>Instagram DM conversations (instagram_manage_messages)</h2>
                <div style={{ fontSize: 12, color: '#8696A0', marginBottom: 8 }}>Page: {selectedPage.name}</div>
                {igMessages.length === 0 && <p style={{ color: '#8696A0', fontSize: 13 }}>No Instagram conversations found for this account.</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 0 }}>
                  {igMessages.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => openThread(c, 'instagram')}
                      style={{
                        textAlign: 'left',
                        background: activeThread?.conversationId === c.id ? '#1F2C34' : '#1A2830',
                        border: '1px solid #2A3942',
                        borderRadius: 8,
                        padding: '8px 12px',
                        color: '#D1D7DB',
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      {c.participants?.data?.map((p) => p.username || p.name).join(', ') || 'Conversation'}
                    </button>
                  ))}
                </div>
                {activeThread?.channel === 'instagram' && (
                  <ThreadPanel
                    thread={activeThread}
                    messages={threadMessages}
                    draftText={draftText}
                    onDraftChange={setDraftText}
                    onSend={sendMessage}
                    sending={sending}
                    sendResult={sendResult}
                  />
                )}
                {sectionHint('Lists this Page\'s connected Instagram account\'s DM conversations via GET /{page-id}/conversations?platform=instagram. Opening one loads its thread; Send posts a real reply via POST /{page-id}/messages, demonstrating instagram_manage_messages.')}
              </>
            )}

            <h2 style={{ fontSize: 16, marginTop: 24, marginBottom: 8 }}>Business Manager assets (business_management)</h2>
            {businessAssets.length === 0 && <p style={{ color: '#8696A0', fontSize: 13 }}>No Business Manager assets visible for this account.</p>}
            <ul style={{ paddingLeft: 18, marginBottom: 0 }}>
              {businessAssets.map((b) => (
                <li key={b.id} style={{ fontSize: 13, color: '#D1D7DB' }}>{b.name}</li>
              ))}
            </ul>
            {sectionHint('Lists Business Manager assets this user has access to via GET /me/businesses, demonstrating business_management.')}

            {/* ---- Ads Manager (ads_read / ads_management) ---- */}
            <h2 style={{ fontSize: 16, marginTop: 24, marginBottom: 8 }}>Ad accounts &amp; campaigns (ads_read, ads_management)</h2>
            {adAccountsLoading && <p style={{ color: '#8696A0', fontSize: 13 }}>Loading ad accounts…</p>}
            {!adAccountsLoading && adAccounts.length === 0 && <p style={{ color: '#8696A0', fontSize: 13 }}>No ad accounts visible for this user.</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
              {adAccounts.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => selectAdAccount(acc)}
                  style={{
                    textAlign: 'left',
                    background: selectedAdAccount?.id === acc.id ? '#1F2C34' : '#1A2830',
                    border: '1px solid #2A3942',
                    borderRadius: 8,
                    padding: '10px 14px',
                    color: '#E9EDEF',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{acc.name}</div>
                  <div style={{ fontSize: 12, color: '#8696A0' }}>
                    {acc.id} &middot; {acc.currency || ''} &middot; status {acc.account_status ?? 'n/a'}
                  </div>
                </button>
              ))}
            </div>
            {sectionHint('Lists ad accounts this user can access via GET /me/adaccounts, demonstrating ads_read.')}

            {selectedAdAccount && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Campaigns in {selectedAdAccount.name}</div>
                {campaigns.length === 0 && <p style={{ color: '#8696A0', fontSize: 13 }}>No campaigns yet in this ad account.</p>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                  {campaigns.map((c) => (
                    <div key={c.id} style={{ background: '#1A2830', border: '1px solid #2A3942', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#D1D7DB' }}>
                      {c.name} — <span style={{ color: '#8696A0' }}>{c.status}{c.objective ? ` · ${c.objective}` : ''}</span>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: 12, color: '#8696A0', marginBottom: 6 }}>
                  Created campaigns are always PAUSED — this demonstrates the write call with zero ad spend.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={newCampaignName}
                    onChange={(e) => setNewCampaignName(e.target.value)}
                    placeholder="New campaign name…"
                    style={{
                      flex: 1,
                      background: '#1A2830',
                      border: '1px solid #2A3942',
                      borderRadius: 6,
                      padding: '8px 10px',
                      color: '#E9EDEF',
                      fontSize: 13,
                    }}
                  />
                  <button
                    onClick={createCampaign}
                    disabled={creatingCampaign || !newCampaignName.trim()}
                    style={{
                      background: '#1877F2',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      padding: '8px 16px',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: creatingCampaign ? 'default' : 'pointer',
                      opacity: creatingCampaign || !newCampaignName.trim() ? 0.7 : 1,
                    }}
                  >
                    {creatingCampaign ? 'Creating…' : 'Create campaign'}
                  </button>
                </div>
                {createCampaignResult && (
                  <div style={{ marginTop: 8, fontSize: 12, color: createCampaignResult.ok ? '#4ADE80' : '#F87171' }}>{createCampaignResult.message}</div>
                )}
                {sectionHint('Lists campaigns via GET /{ad-account-id}/campaigns and creates a real, PAUSED campaign via POST /{ad-account-id}/campaigns, demonstrating ads_management.')}
              </div>
            )}
          </div>
        )}

        <h2 style={{ fontSize: 14, marginTop: 32, marginBottom: 8, color: '#8696A0' }}>Activity log</h2>
        <div style={{ background: '#111B21', border: '1px solid #2A3942', borderRadius: 8, padding: 12, fontSize: 12, color: '#8696A0', maxHeight: 220, overflowY: 'auto' }}>
          {log.length === 0 ? <div>Waiting for login…</div> : log.map((line, i) => <div key={i}>{line}</div>)}
        </div>
        <p style={{ color: '#5B6770', fontSize: 11, marginTop: 6 }}>
          This log records which permission was exercised and what was found — never access tokens, app secrets, or Page tokens.
        </p>
      </div>
    </div>
  );
}

function ThreadPanel({
  thread,
  messages,
  draftText,
  onDraftChange,
  onSend,
  sending,
  sendResult,
}: {
  thread: ActiveThread;
  messages: ThreadMessage[];
  draftText: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  sendResult: { ok: boolean; message: string } | null;
}) {
  return (
    <div style={{ marginTop: 8, background: '#111B21', border: '1px solid #2A3942', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 12, color: '#8696A0', marginBottom: 8 }}>Thread with {thread.recipientLabel}</div>
      <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {messages.length === 0 && <div style={{ fontSize: 12, color: '#8696A0' }}>No messages in this thread yet.</div>}
        {messages.map((m) => (
          <div key={m.id} style={{ fontSize: 13, color: '#D1D7DB' }}>
            <span style={{ color: '#8696A0' }}>{m.from}:</span> {m.message}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draftText}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Type a reply…"
          style={{
            flex: 1,
            background: '#1A2830',
            border: '1px solid #2A3942',
            borderRadius: 6,
            padding: '8px 10px',
            color: '#E9EDEF',
            fontSize: 13,
          }}
        />
        <button
          onClick={onSend}
          disabled={sending || !draftText.trim()}
          style={{
            background: '#1877F2',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: sending ? 'default' : 'pointer',
            opacity: sending || !draftText.trim() ? 0.7 : 1,
          }}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {sendResult && (
        <div style={{ marginTop: 8, fontSize: 12, color: sendResult.ok ? '#4ADE80' : '#F87171' }}>{sendResult.message}</div>
      )}
    </div>
  );
}
