import type { Quote } from "@/types/content";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/\son[a-z]+=("[^"]*"|'[^']*')/gi, "")
    .replace(/\sstyle=("[^"]*"|'[^']*')/gi, "")
    .replace(/<table(\s|>)/gi, '<div class="overflow-x-auto"><table$1')
    .replace(/<\/table>/gi, "</table></div>");
}

function buildQuoteHtml(quote: Quote | undefined): string {
  if (!quote) {
    return `<blockquote class=\"quote-fallback\">引用内容待补全</blockquote>`;
  }
  const author = quote.author ? `<cite>—— ${escapeHtml(String(quote.author))}</cite>` : "";
  return `<blockquote class=\"quote-card\"><p>${escapeHtml(quote.content)}</p>${author}</blockquote>`;
}

export function RichTextRenderer({ html, quotesById }: { html: string; quotesById: Record<number, Quote> }) {
  const sanitized = sanitizeHtml(html || "");
  const withQuotes = sanitized.replace(/\[quote:id=(\d+)\]/g, (_, idText: string) => {
    const id = Number(idText);
    const quote = Number.isFinite(id) ? quotesById[id] : undefined;
    return buildQuoteHtml(quote);
  });

  return (
    <article>
      <div dangerouslySetInnerHTML={{ __html: withQuotes }} />
      <noscript>
        <p>您的浏览器已禁用脚本，页面已展示静态名言内容。</p>
      </noscript>
    </article>
  );
}
