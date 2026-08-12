<template>
  <div v-if="article" class="max-w-3xl">
    <NuxtLink to="/help" class="press mb-3 inline-flex items-center gap-1 text-[12px] font-semibold text-brown">
      ‹ Help centre
    </NuxtLink>
    <div class="border-b border-line pb-4">
      <p class="eyebrow">{{ article.category }}</p>
      <h1 class="font-display text-[26px] font-bold leading-8 tracking-tight text-ink">{{ article.title }}</h1>
      <p v-if="article.summary" class="mt-1 text-[13px] text-muted">{{ article.summary }}</p>
      <NuxtLink v-if="article.primary_path" :to="article.primary_path" class="mt-3 inline-block">
        <UiButton size="sm" variant="tonal">Go to {{ article.primary_path }}</UiButton>
      </NuxtLink>
    </div>

    <!-- Markdown rendered to the same warm type scale as the rest of the app -->
    <article class="help-body" v-html="rendered" />

    <p class="mt-10 border-t border-line-soft pt-3 text-[11px] text-muted">
      Last updated {{ fmtDate(article.updated_at) }}
    </p>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const { data: res } = await useFetch<any>(`/api/v1/help/${route.params.slug}`, { lazy: true })
const article = computed<any>(() => res.value?.data)

/**
 * Small markdown renderer — headings, tables, lists, code, blockquotes, links,
 * bold/italic. Enough for the help corpus and avoids shipping a parser for ten
 * files. Article bodies are repo-authored, not user input.
 */
const rendered = computed(() => {
  const md = article.value?.body_md || ''
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s: string) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  const out: string[] = []
  const lines = md.split(/\r?\n/)
  let i = 0
  let listOpen: 'ul' | 'ol' | null = null

  const closeList = () => { if (listOpen) { out.push(`</${listOpen}>`); listOpen = null } }

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code
    if (/^```/.test(line)) {
      closeList()
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++])
      i++
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`)
      continue
    }

    // Table (header | --- | rows)
    if (/^\|/.test(line) && /^\|[\s:|-]+\|?$/.test(lines[i + 1] || '')) {
      closeList()
      const cells = (l: string) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]))
      out.push(
        `<div class="help-table-wrap"><table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
      )
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      closeList()
      const level = Math.min(heading[1].length + 1, 5) // h1 in body becomes h2
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      i++
      continue
    }

    if (/^>\s?/.test(line)) {
      closeList()
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''))
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`)
      continue
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/)
    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    if (ol || ul) {
      const want = ol ? 'ol' : 'ul'
      if (listOpen !== want) { closeList(); out.push(`<${want}>`); listOpen = want }
      out.push(`<li>${inline((ol || ul)![1])}</li>`)
      i++
      continue
    }

    if (!line.trim()) { closeList(); i++; continue }

    closeList()
    const buf: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|>|```|\||\s*[-*]\s|\s*\d+\.\s)/.test(lines[i])) {
      buf.push(lines[i++])
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`)
  }
  closeList()
  return out.join('\n')
})

function fmtDate(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Singapore' })
}
</script>

<style>
.help-body { color: #3A2415; font-size: 14px; line-height: 1.65; }
.help-body h2 { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 22px; margin: 28px 0 8px; }
.help-body h3 { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 18px; margin: 22px 0 6px; }
.help-body h4 { font-weight: 600; font-size: 15px; margin: 18px 0 4px; }
.help-body p { margin: 10px 0; }
.help-body ul, .help-body ol { margin: 10px 0 10px 20px; }
.help-body ul { list-style: disc; }
.help-body ol { list-style: decimal; }
.help-body li { margin: 5px 0; }
.help-body a { color: #3A2415; text-decoration: underline; text-decoration-color: rgba(58, 36, 21, 0.3); text-underline-offset: 2px; }
.help-body code { background: #FBF7EE; border-radius: 5px; padding: 1px 5px; font-size: 12px; font-family: ui-monospace, monospace; }
.help-body pre { background: #FBF7EE; border-radius: 10px; padding: 12px 14px; overflow-x: auto; margin: 12px 0; }
.help-body pre code { background: none; padding: 0; font-size: 11.5px; line-height: 1.6; }
.help-body blockquote { border-left: 3px solid #FFE14D; background: #FFF4A8; border-radius: 0 10px 10px 0; padding: 10px 14px; margin: 14px 0; font-size: 13px; }
.help-body .help-table-wrap { overflow-x: auto; margin: 14px 0; }
.help-body table { width: 100%; border-collapse: collapse; font-size: 13px; }
.help-body th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; color: #8B7355; border-bottom: 1px solid #EDE4D4; padding: 7px 10px 7px 0; }
.help-body td { border-bottom: 1px solid #F4EDDF; padding: 8px 10px 8px 0; vertical-align: top; }
.help-body strong { font-weight: 600; }
</style>
