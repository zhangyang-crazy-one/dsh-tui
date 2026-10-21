/** Bounded, non-evaluating lexical highlighting shared by JSX and physical rows. */
export type SyntaxKind = 'plain' | 'keyword' | 'string' | 'comment'
export interface SyntaxToken { kind: SyntaxKind; text: string }

const words = (source: string): ReadonlySet<string> => new Set(source.split(' '))
const js = words('const let var function return if else for while import export from async await class interface type new throw try catch finally switch case break continue default true false null undefined this extends implements public private readonly yield typeof instanceof in of void delete static get set')
interface Grammar { keywords: ReadonlySet<string>; comments: readonly string[]; block?: readonly [string, string]; quotes: string; insensitive?: boolean }
const grammars: Readonly<Record<string, Grammar>> = {
  js: { keywords: js, comments: ['//'], block: ['/*', '*/'], quotes: '\'"`' },
  py: { keywords: words('def class return if elif else for while import from as async await with try except finally raise pass break continue True False None and or not in is lambda yield global nonlocal assert del'), comments: ['#'], quotes: '\'"' },
  go: { keywords: words('package import func return if else for range switch case default break continue defer go chan select struct interface type var const map make nil true false'), comments: ['//'], block: ['/*', '*/'], quotes: '\'"`' },
  rust: { keywords: words('pub fn let mut const static impl trait struct enum match use mod crate self Self super return if else for while loop break continue async await move ref unsafe where type dyn true false'), comments: ['//'], block: ['/*', '*/'], quotes: '"' },
  sh: { keywords: words('if then else elif fi for do done while until case esac in function select export local readonly return exit true false'), comments: ['#'], quotes: '\'"`' },
  sql: { keywords: words('select from where join inner left right outer on as insert into values update set delete create alter drop table index group by order limit offset having union distinct and or not null true false exists with'), comments: ['--'], block: ['/*', '*/'], quotes: '\'"', insensitive: true },
  json: { keywords: words('true false null'), comments: [], quotes: '"' },
  yaml: { keywords: words('true false null yes no'), comments: ['#'], quotes: '\'"' },
  c: { keywords: words('int char float double void bool const static struct enum typedef return if else for while do switch case break continue include define unsigned signed long short sizeof auto class public private virtual template namespace using new delete nullptr true false'), comments: ['//'], block: ['/*', '*/'], quotes: '\'"' },
}
const aliases: Readonly<Record<string, string>> = { javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', python: 'py', bash: 'sh', shell: 'sh', zsh: 'sh', rs: 'rust', golang: 'go', yml: 'yaml', cpp: 'c', cc: 'c', java: 'c', csharp: 'c', jsonc: 'js' }

/** One forward scan. Unknown fences and source over 32 KiB remain plain. */
export function syntaxTokens(source: string, language: string): SyntaxToken[] {
  const lang = language.toLowerCase().split(/\s/u)[0] ?? ''
  const grammar = grammars[aliases[lang] ?? lang]
  if (grammar === undefined || source.length > 32768) return [{ kind: 'plain', text: source }]
  const result: SyntaxToken[] = []
  const push = (kind: SyntaxKind, start: number, end: number): void => {
    if (end <= start) return
    const previous = result.at(-1)
    const text = source.slice(start, end)
    if (kind === 'plain' && previous?.kind === kind) previous.text += text
    else result.push({ kind, text })
  }
  let i = 0
  while (i < source.length) {
    const start = i
    if (grammar.block !== undefined && source.startsWith(grammar.block[0], i)) {
      const end = source.indexOf(grammar.block[1], i + grammar.block[0].length)
      i = end < 0 ? source.length : end + grammar.block[1].length
      push('comment', start, i)
      continue
    }
    const comment = grammar.comments.find(prefix => source.startsWith(prefix, i))
    if (comment !== undefined) {
      const end = source.indexOf('\n', i)
      i = end < 0 ? source.length : end
      push('comment', start, i)
      continue
    }
    const quote = source[i]!
    if (grammar.quotes.includes(quote)) {
      i += 1
      while (i < source.length) {
        if (source[i] === '\\') { i = Math.min(source.length, i + 2);continue }
        if (source[i++] === quote) break
      }
      push('string', start, i)
      continue
    }
    if (/[A-Za-z_$]/u.test(quote)) {
      i += 1
      while (i < source.length && /[A-Za-z0-9_$]/u.test(source[i]!)) i += 1
      const word = source.slice(start, i)
      push(grammar.keywords.has(grammar.insensitive ? word.toLowerCase() : word) ? 'keyword' : 'plain', start, i)
      continue
    }
    push('plain', i, ++i)
  }
  return result
}

/** Split lexical spans into source rows while carrying multiline lexical state. */
export function syntaxLines(source: string, language: string): SyntaxToken[][] {
  const rows: SyntaxToken[][] = [[]]
  for (const token of syntaxTokens(source, language)) {
    const parts = token.text.split('\n')
    for (const [index, text] of parts.entries()) {
      if (index > 0) rows.push([])
      if (text !== '') rows.at(-1)!.push({ kind: token.kind, text })
    }
  }
  return rows
}
