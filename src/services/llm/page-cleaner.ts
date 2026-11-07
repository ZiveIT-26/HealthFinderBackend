import * as cheerio from 'cheerio';

export type CleanedPage = {
  title: string;
  /** Readable page text; links are kept inline as [text](/path) or [text](https://other-site). */
  text: string;
  originalChars: number;
  truncated: boolean;
};

/** Elements that never carry useful content for the model. */
const NOISE_SELECTOR = [
  'script', 'style', 'noscript', 'template', 'svg', 'iframe', 'canvas',
  'form', 'input', 'button', 'select', 'textarea', 'img', 'picture', 'video', 'audio',
  'header', 'nav', 'footer', 'link', 'meta',
].join(', ');

/** Elements after which a line break is inserted, so the text keeps its structure. */
const BLOCK_SELECTOR = [
  'p', 'div', 'section', 'article', 'aside', 'li', 'ul', 'ol', 'table', 'tr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dt', 'dd', 'address',
].join(', ');

export const DEFAULT_MAX_PAGE_CHARS = 12_000;

/**
 * Turns a raw HTML page into compact text for the LLM:
 * removes scripts, styles, navigation, attributes and data blobs,
 * keeps headings, text and links (same-site links as short paths), then truncates.
 */
export function cleanHtmlPage(
  html: string,
  pageUrl: string,
  maxChars = DEFAULT_MAX_PAGE_CHARS,
): CleanedPage {
  const $ = cheerio.load(html);
  const title = collapseSpaces($('title').first().text());

  $(NOISE_SELECTOR).remove();
  const root = $('main').length > 0 ? $('main').first() : $('body');

  // Inline elements next to each other ("<span>A</span><span>B</span>") must not glue together.
  root.find('span, strong, em, b, i, small, label').after(' ');

  // Links: flatten each link (even a whole "card") into one inline token.
  // Same-site links are shown as a short path; a URL already shown is not repeated.
  const pageHost = new URL(pageUrl).host;
  const seenLinks = new Set<string>();
  root.find('a').each((_, element) => {
    const link = $(element);
    const text = collapseSpaces(link.text());
    const href = toAbsoluteHttpUrl(link.attr('href'), pageUrl);
    if (!href || !text || seenLinks.has(href)) {
      link.replaceWith(` ${text} `);
      return;
    }
    seenLinks.add(href);
    const url = new URL(href);
    const shown = url.host === pageHost ? `${url.pathname}${url.search}` : href;
    link.replaceWith(` [${text}](${shown}) `);
  });

  root.find('h1, h2, h3').each((_, element) => {
    $(element).prepend('## ');
  });
  root.find('br').replaceWith('\n');
  root.find(BLOCK_SELECTOR).after('\n');

  const lines: string[] = [];
  for (const rawLine of root.text().split('\n')) {
    const line = collapseSpaces(rawLine);
    if (line && line !== '##' && line !== lines[lines.length - 1]) {
      lines.push(line);
    }
  }

  const fullText = lines.join('\n');
  const truncated = fullText.length > maxChars;
  const text = truncated
    ? `${fullText.slice(0, maxChars)}\n[... truncated: showing ${maxChars} of ${fullText.length} characters]`
    : fullText;

  return { title, text, originalChars: html.length, truncated };
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function toAbsoluteHttpUrl(href: string | undefined, base: string): string | undefined {
  if (!href || href.startsWith('#')) return undefined;
  try {
    const url = new URL(href, base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}
