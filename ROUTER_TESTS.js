const assert = require('assert');
const base = '/tmp/t/out/home/claude/proj/BMS-AI-main/src/lib/ai/';
const calls = [];
let script = {};   // url-substring -> array of responders
function res(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body };
}
global.fetch = async (url, init) => {
  const key = Object.keys(script).find(k => String(url).includes(k));
  calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
  if (!key) throw new Error('unexpected url ' + url);
  const q = script[key];
  const r = q.length > 1 ? q.shift() : q[0];
  if (r === 'timeout') { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }
  return r;
};
const gemOk = t => res(200, { candidates: [{ content: { parts: [{ text: t }] } }] });
const oaiOk = t => res(200, { choices: [{ message: { content: t } }] });
const antOk = t => res(200, { content: [{ type: 'text', text: t }] });
const gem429 = () => res(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota' } });
const n = k => calls.filter(c => c.url.includes(k)).length;
function fresh() {
  Object.keys(require.cache).filter(k => k.includes('/out/')).forEach(k => delete require.cache[k]);
  calls.length = 0;
  for (const k of ['GEMINI_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','TAVILY_API_KEY','BRAVE_SEARCH_API_KEY']) delete process.env[k];
  return require(base + 'router.js');
}
const msgs = [{ role: 'user', content: 'hi' }];
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('429 on Gemini -> fallback, no retry; next request skips Gemini entirely', async () => {
  const r = fresh(); process.env.GEMINI_API_KEY='g'; process.env.OPENAI_API_KEY='o';
  script = { 'googleapis': [gem429()], 'openai.com': [oaiOk('from openai')] };
  const a = await r.routeChat({ messages: msgs, mode: 'fast', requested: 'auto' });
  assert.equal(a.result.provider, 'openai'); assert.equal(n('googleapis'), 1);
  assert.match(a.notice, /Gemini usage limit reached/);
  await r.routeChat({ messages: msgs, mode: 'fast', requested: 'auto' });
  assert.equal(n('googleapis'), 1, 'Gemini must not be called again during cooldown');
  assert.equal(n('openai.com'), 2);
});
t('503 twice then success -> retried on same provider, no cooldown', async () => {
  const r = fresh(); process.env.GEMINI_API_KEY='g'; process.env.OPENAI_API_KEY='o';
  script = { 'googleapis': [res(503,{error:{message:'overloaded'}}), res(503,{error:{message:'overloaded'}}), gemOk('ok')], 'openai.com': [oaiOk('x')] };
  const a = await r.routeChat({ messages: msgs, mode: 'fast', requested: 'auto' });
  assert.equal(a.result.provider, 'gemini'); assert.equal(n('googleapis'), 3); assert.equal(n('openai.com'), 0);
  assert.equal(a.notice, undefined);
});
t('persistent 503 -> 3 tries then falls to next provider', async () => {
  const r = fresh(); process.env.GEMINI_API_KEY='g'; process.env.ANTHROPIC_API_KEY='a';
  script = { 'googleapis': [res(503,{error:{message:'busy'}})], 'anthropic.com': [antOk('claude')] };
  const a = await r.routeChat({ messages: msgs, mode: 'fast', requested: 'auto' });
  assert.equal(a.result.provider, 'anthropic'); assert.equal(n('googleapis'), 3);
  assert.match(a.notice, /temporarily unavailable/);
});
t('every provider 429 -> HTTP 429 quota message, one call each', async () => {
  const r = fresh(); process.env.GEMINI_API_KEY='g'; process.env.OPENAI_API_KEY='o';
  script = { 'googleapis': [gem429()], 'openai.com': [res(429,{error:{type:'insufficient_quota',message:'quota'}})] };
  await assert.rejects(r.routeChat({ messages: msgs, mode: 'fast', requested: 'auto' }), e => {
    assert.equal(e.httpStatus, 429); assert.equal(e.code, 'quota'); assert.match(e.message, /Gemini/); assert.match(e.message, /OpenAI/); return true; });
  assert.equal(n('googleapis'), 1); assert.equal(n('openai.com'), 1);
});
t('mixed 429 + 503 -> HTTP 503 unavailable', async () => {
  const r = fresh(); process.env.GEMINI_API_KEY='g'; process.env.OPENAI_API_KEY='o';
  script = { 'googleapis': [gem429()], 'openai.com': [res(503,{error:{message:'x'}})] };
  await assert.rejects(r.routeChat({ messages: msgs, mode: 'fast', requested: 'auto' }), e => { assert.equal(e.httpStatus, 503); assert.equal(e.code, 'unavailable'); return true; });
});
t('no keys -> no_provider', async () => {
  const r = fresh(); script = {};
  await assert.rejects(r.routeChat({ messages: msgs, mode: 'fast', requested: 'auto' }), e => { assert.equal(e.code, 'no_provider'); return true; });
});
t('timeout retried once, then falls back', async () => {
  const r = fresh(); process.env.GEMINI_API_KEY='g'; process.env.OPENAI_API_KEY='o';
  script = { 'googleapis': ['timeout'], 'openai.com': [oaiOk('o')] };
  const a = await r.routeChat({ messages: msgs, mode: 'fast', requested: 'auto' });
  assert.equal(n('googleapis'), 2); assert.equal(a.result.provider, 'openai');
});
t('401 marks key bad and is not retried', async () => {
  const r = fresh(); process.env.GEMINI_API_KEY='g'; process.env.OPENAI_API_KEY='o';
  script = { 'googleapis': [res(403,{error:{message:'bad key'}})], 'openai.com': [oaiOk('o')] };
  await r.routeChat({ messages: msgs, mode: 'fast', requested: 'auto' }); await r.routeChat({ messages: msgs, mode: 'fast', requested: 'auto' });
  assert.equal(n('googleapis'), 1);
});
t('manual provider choice goes first, others are fallback', async () => {
  const r = fresh(); process.env.GEMINI_API_KEY='g'; process.env.OPENAI_API_KEY='o';
  script = { 'googleapis': [gemOk('g')], 'openai.com': [oaiOk('o')] };
  const a = await r.routeChat({ messages: msgs, mode: 'fast', requested: 'openai' });
  assert.equal(a.result.provider, 'openai'); assert.equal(n('googleapis'), 0);
});
t('research with Tavily: sources injected into system prompt for fallback provider', async () => {
  const r = fresh(); process.env.GEMINI_API_KEY='g'; process.env.OPENAI_API_KEY='o'; process.env.TAVILY_API_KEY='t';
  script = { 'tavily.com': [res(200,{results:[{title:'T',url:'https://x.test/a',content:'fact'}]})], 'googleapis': [gem429()], 'openai.com': [oaiOk('answer [1]')] };
  const a = await r.routeChat({ messages: [{role:'user',content:'news?'}], mode: 'research', requested: 'auto' });
  assert.equal(n('tavily.com'), 1, 'one search only');
  const oai = calls.find(c => c.url.includes('openai.com'));
  assert.match(oai.body.messages[0].content, /WEB SEARCH RESULTS[\s\S]*https:\/\/x\.test\/a/);
  assert.equal(a.result.sources[0].url, 'https://x.test/a');
  assert.equal(a.notice.includes('not based on current web sources'), false);
});
t('research without search key: Gemini uses native google_search grounding', async () => {
  const r = fresh(); process.env.GEMINI_API_KEY='g';
  script = { 'googleapis': [res(200,{candidates:[{content:{parts:[{text:'grounded'}]},groundingMetadata:{groundingChunks:[{web:{uri:'https://w.test',title:'W'}}]}}]})] };
  const a = await r.routeChat({ messages: msgs, mode: 'research', requested: 'auto' });
  assert.deepEqual(calls[0].body.tools, [{ google_search: {} }]);
  assert.equal(a.result.sources[0].url, 'https://w.test'); assert.equal(a.notice, undefined);
});
t('research without search key and Gemini out: honest notice on fallback', async () => {
  const r = fresh(); process.env.GEMINI_API_KEY='g'; process.env.OPENAI_API_KEY='o';
  script = { 'googleapis': [gem429()], 'openai.com': [oaiOk('o')] };
  const a = await r.routeChat({ messages: msgs, mode: 'research', requested: 'auto' });
  assert.match(a.notice, /Live web search was unavailable/);
});
t('Tavily down -> Brave used', async () => {
  const r = fresh(); process.env.GEMINI_API_KEY='g'; process.env.TAVILY_API_KEY='t'; process.env.BRAVE_SEARCH_API_KEY='b';
  script = { 'tavily.com': [res(500,{})], 'brave.com': [res(200,{web:{results:[{title:'B',url:'https://b.test',description:'<b>d</b>'}]}})], 'googleapis': [gemOk('g')] };
  const a = await r.routeChat({ messages: msgs, mode: 'research', requested: 'auto' });
  assert.equal(a.result.sources[0].url, 'https://b.test'); assert.equal(calls.find(c=>c.url.includes('googleapis')).body.tools, undefined);
});
t('all four modes produce a request', async () => {
  for (const mode of ['fast','thinking','coding','research']) {
    const r = fresh(); process.env.GEMINI_API_KEY='g'; script = { 'googleapis': [gemOk('x')] };
    const a = await r.routeChat({ messages: msgs, mode, requested: 'auto' }); assert.equal(a.result.text, 'x');
    assert.match(calls.at(-1).body.systemInstruction.parts[0].text, mode==='thinking'?/DEEP THINKING/:new RegExp(mode==='research'?'RESEARCH':mode.toUpperCase()));
  }
});
(async () => {
  let fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '\n  ', e.message); }
  }
  process.exit(fail ? 1 : 0);
})();
