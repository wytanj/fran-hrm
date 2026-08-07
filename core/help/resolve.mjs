// Deterministic help-article resolution, shared by the /help UI and the MCP
// help tools. Ported from fran-skums with HR intents.
//
// Deliberately not embeddings: ranking must be explainable and stable, so an
// operator can add an intent_tag and know exactly which question it fixes.

const STOP = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'at', 'my', 'me', 'i',
  'do', 'does', 'how', 'what', 'where', 'which', 'can', 'should', 'would',
  'go', 'get', 'with', 'from', 'and', 'or', 'is', 'are', 'be', 'this', 'that',
  'please', 'help', 'need', 'want', 'page', 'screen', 'am', 'if', 'it',
])

export function tokenizeHelpQuery(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s\-/]/g, ' ')
    .split(/[\s/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t))
}

export function scoreHelpArticle(article, tokens, rawQuery = '') {
  if (!article) return 0
  const q = String(rawQuery || '').toLowerCase()
  const title = String(article.title || '').toLowerCase()
  const summary = String(article.summary || '').toLowerCase()
  const slug = String(article.slug || '').toLowerCase()
  const tags = Array.isArray(article.intent_tags) ? article.intent_tags.map((t) => String(t).toLowerCase()) : []
  const body = String(article.body_md || '').toLowerCase().slice(0, 2000)

  let score = 0
  for (const t of tokens) {
    if (tags.some((tag) => tag === t || tag.includes(t) || t.includes(tag))) score += 4
    if (title.includes(t)) score += 3
    if (slug.includes(t)) score += 2
    if (summary.includes(t)) score += 2
    if (body.includes(t)) score += 0.5
  }

  const blob = `${slug} ${title} ${tags.join(' ')} ${summary}`

  // Intent boosts. Each line encodes a real question staff ask.
  if (/\b(clock|punch|scan|qr|check.?in|check.?out)\b/.test(q) && /clock|qr|attendance/.test(blob)) score += 5
  // Scoped to the corrections article specifically: "forgot to clock out" must
  // not be won by the general clocking article just because it says "clock".
  if (/\b(forgot|missed|wrong time|didn.?t clock|correction|amend|fix)\b/.test(q) && /correction/.test(blob)) score += 10
  if (/\b(leave|mc|medical|annual|off day|holiday|time off|absent)\b/.test(q) && /leave/.test(blob)) score += 5
  if (/\b(balance|entitle|how many days)\b/.test(q) && /leave|balance/.test(blob)) score += 4
  if (/\b(roster|schedule|shift|when.*work|working)\b/.test(q) && /roster|shift|schedul/.test(blob)) score += 5
  if (/\b(publish|draft)\b/.test(q) && /roster|publish/.test(blob)) score += 5
  // Generation vs import vs publishing all mention "roster"; disambiguate on
  // the verb so each question lands on its own article.
  if (/\b(generate|auto|automatic|automatically|ai|build .*for me|constraint|constraints|coverage|unfilled|cannot fill|can.?t fill)\b/.test(q) && /generate/.test(blob)) score += 9
  if (/\b(import|upload|paste|spreadsheet|sheet|sheets|excel|csv|airtable|export|download|mapping|column)\b/.test(q) && /import-export/.test(blob)) score += 9
  if (/\b(swap|exchange|cover|change shift)\b/.test(q) && /swap/.test(blob)) score += 6
  if (/\b(availab|prefer|can.?t work|unavailab)\b/.test(q) && /availab/.test(blob)) score += 6
  if (/\b(ot|overtime|extra hours|44)\b/.test(q) && /overtime|ot|hours/.test(blob)) score += 6
  if (/\b(late|no.?show|lateness|absent)\b/.test(q) && /flag|late|adherence|attendance/.test(blob)) score += 5
  if (/\b(payroll|pay period|lock|locked|payslip)\b/.test(q) && /payroll|lock|pay/.test(blob)) score += 6
  if (/\b(part.?time|pt|cap|hour cap)\b/.test(q) && /part.?time|pt|cap/.test(blob)) score += 5
  if (/\b(offline|down|downtime|system.*not work|cannot login)\b/.test(q) && /offline|downtime/.test(blob)) score += 6
  if (/\b(claude|mcp|connector|ai|assistant)\b/.test(q) && /claude|mcp|connect/.test(blob)) score += 6
  if (/\b(pin|password|locked out|sign in|login)\b/.test(q) && /pin|sign.?in|login|access/.test(blob)) score += 5
  if (/\b(pos|register|cashier)\b/.test(q) && /pos/.test(blob)) score += 4
  if (/\b(export|report|csv|excel)\b/.test(q) && /report|export/.test(blob)) score += 5

  return score
}

export function compactHelpArticle(article) {
  if (!article) return null
  return {
    slug: article.slug,
    title: article.title,
    summary: article.summary || null,
    category: article.category,
    primary_path: article.primary_path || null,
    related_paths: article.related_paths || [],
    intent_tags: article.intent_tags || [],
    audience: article.audience || [],
    help_path: `/help/${article.slug}`,
    sort_order: article.sort_order ?? 100,
  }
}

/** First few numbered steps, so a caller can answer without a second hop. */
function extractStepsPreview(body) {
  const steps = []
  for (const line of String(body || '').split(/\r?\n/)) {
    const m = line.match(/^\s*\d+\.\s+(.+)/)
    if (m) steps.push(m[1].trim())
    if (steps.length >= 6) break
  }
  return steps
}

export function rankHelpArticles(articles, query, opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 5, 1), 10)
  const minScore = opts.min_score ?? 2
  const tokens = tokenizeHelpQuery(query)
  const ranked = (articles || [])
    .map((a) => ({ article: a, score: scoreHelpArticle(a, tokens, query) }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score || (a.article.sort_order ?? 100) - (b.article.sort_order ?? 100))
    .slice(0, limit)

  return {
    query: String(query || ''),
    tokens,
    matches: ranked.map((r) => ({
      ...compactHelpArticle(r.article),
      confidence: Math.min(0.99, Math.round((r.score / 20) * 100) / 100),
      score: r.score,
      steps_preview: extractStepsPreview(r.article.body_md),
    })),
    needs_clarification: ranked.length === 0,
    help_index_path: '/help',
  }
}

/** Load published articles and rank, attaching body excerpts to top matches. */
export async function resolveHelp(db, workspaceId, query, opts = {}) {
  const { data, error } = await db
    .from('help_articles')
    .select('slug, title, summary, body_md, category, primary_path, related_paths, intent_tags, audience, sort_order')
    .eq('workspace_id', workspaceId)
    .eq('published', true)
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)

  let pool = data || []
  // Audience filter: a store manager asking about publishing should not be
  // out-ranked by a staff-only article, but never hide content outright —
  // empty audience means everyone.
  if (opts.role) {
    const relevant = pool.filter((a) => !a.audience?.length || a.audience.includes(opts.role))
    if (relevant.length) pool = relevant
  }

  const result = rankHelpArticles(pool, query, opts)

  if (result.needs_clarification || !result.matches.length) {
    result.suggestions = pool.slice(0, 8).map(compactHelpArticle)
    result.message = 'No strong help match. Browse /help or pick a suggestion. Do not invent FranHRM screens or policy — say you are unsure instead.'
  } else {
    const bySlug = new Map(pool.map((a) => [a.slug, a]))
    for (let i = 0; i < Math.min(3, result.matches.length); i++) {
      const full = bySlug.get(result.matches[i].slug)
      if (full) result.matches[i].body_excerpt = String(full.body_md || '').slice(0, 4000)
    }
  }

  result.hint = 'Answer from body_excerpt / steps_preview. For the full article call help_get with the slug. Link the user to /help/{slug}. This content is the current policy — prefer it over your own assumptions.'
  return result
}

export async function listHelpArticles(db, workspaceId, opts = {}) {
  let q = db
    .from('help_articles')
    .select('slug, title, summary, category, primary_path, related_paths, intent_tags, audience, sort_order, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('published', true)
    .order('sort_order', { ascending: true })
  if (opts.category) q = q.eq('category', opts.category)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data || []).map(compactHelpArticle)
}

export async function getHelpArticle(db, workspaceId, slug, opts = {}) {
  const maxBody = Math.min(Math.max(Number(opts.max_body_chars) || 12000, 500), 20000)
  const raw = String(slug || '').trim().replace(/^\/?help\//, '')
  if (!raw) return { found: false, message: 'slug is required', help_index_path: '/help' }

  const { data: article, error } = await db
    .from('help_articles').select('*')
    .eq('workspace_id', workspaceId).eq('slug', raw).eq('published', true).maybeSingle()
  if (error) throw new Error(error.message)
  if (!article) {
    return {
      found: false,
      slug: raw,
      message: `No published help article for slug "${raw}". Call help_search or help_list instead of guessing.`,
      help_index_path: '/help',
    }
  }

  const body = String(article.body_md || '')
  return {
    found: true,
    slug: article.slug,
    title: article.title,
    summary: article.summary || null,
    category: article.category,
    primary_path: article.primary_path || null,
    related_paths: article.related_paths || [],
    intent_tags: article.intent_tags || [],
    audience: article.audience || [],
    help_path: `/help/${article.slug}`,
    steps_preview: extractStepsPreview(body),
    body_md: body.length > maxBody ? `${body.slice(0, maxBody)}\n\n…(truncated)` : body,
    body_truncated: body.length > maxBody,
    updated_at: article.updated_at || null,
  }
}
