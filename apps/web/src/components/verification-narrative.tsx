'use client';

import { useEffect, type ReactNode } from 'react';
import { track } from '@/lib/analytics';

/**
 * The AI narrative renderer.
 *
 * Two constraints shape this file. First, the narrative is model output, so it
 * is never trusted as markup: there is no `dangerouslySetInnerHTML` anywhere
 * here and no HTML library in the dependency tree. The text is parsed into a
 * closed set of React elements (headings, paragraphs, lists, bold spans and
 * numbered citation markers) and anything the parser does not recognise falls
 * through as literal text, which is the safe direction to fail in.
 *
 * Second, a citation has to be reachable. Every `[n]` marker becomes a link to
 * the evidence item it cites, so a reader can go from a sentence to the document
 * behind it without leaving the page.
 */

/** Marker `[n]` to the anchor of the evidence item it points at. */
export type CitationAnchors = Record<number, string>;

/* ------------------------------------------------------------------ *
 * Inline
 * ------------------------------------------------------------------ */

const INLINE_PATTERN = /(\*\*[^*]+\*\*)|(\[\d{1,3}\])/g;

function renderInline(text: string, anchors: CitationAnchors, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const token = match[0];
    const at = match.index ?? 0;
    if (at > cursor) nodes.push(text.slice(cursor, at));
    cursor = at + token.length;
    index += 1;

    if (token.startsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-b${index}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
      continue;
    }

    const n = Number(token.slice(1, -1));
    const href = anchors[n];
    nodes.push(
      <a
        key={`${keyPrefix}-c${index}`}
        href={href ?? `#citation-${n}`}
        className="mx-0.5 inline-block translate-y-[-2px] border border-[color:var(--color-seal)] px-1 align-baseline text-[10px] font-medium leading-[1.5] text-[color:var(--color-seal)] no-underline"
      >
        {n}
      </a>,
    );
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/* ------------------------------------------------------------------ *
 * Blocks
 * ------------------------------------------------------------------ */

type Block =
  | { kind: 'heading'; level: 2 | 3 | 4; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] };

const HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;

export function parseNarrative(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  function flushParagraph() {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ').trim() });
      paragraph = [];
    }
  }
  function flushList() {
    if (list && list.items.length > 0) blocks.push({ kind: 'list', ...list });
    list = null;
  }

  for (const line of lines) {
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const hashes = heading[1]?.length ?? 2;
      // The page owns the only h1, so a narrative heading starts at h2.
      const level = (hashes <= 1 ? 2 : Math.min(hashes + 1, 4)) as 2 | 3 | 4;
      blocks.push({ kind: 'heading', level, text: heading[2] ?? '' });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1] ?? '');
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1] ?? '');
      continue;
    }

    if (list) {
      // A continuation line inside a list item.
      const last = list.items.length - 1;
      if (last >= 0) list.items[last] = `${list.items[last]} ${line.trim()}`;
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return blocks;
}

export function VerificationNarrative({
  markdown,
  anchors = {},
}: {
  markdown: string;
  anchors?: CitationAnchors;
}) {
  const blocks = parseNarrative(markdown);

  return (
    <div className="prose-civic">
      {blocks.map((block, index) => {
        const key = `block-${index}`;
        if (block.kind === 'heading') {
          const className = 'font-display mt-6 mb-2 text-base leading-tight first:mt-0';
          const content = renderInline(block.text, anchors, key);
          if (block.level === 2) {
            return (
              <h2 key={key} className={className}>
                {content}
              </h2>
            );
          }
          if (block.level === 3) {
            return (
              <h3 key={key} className={className}>
                {content}
              </h3>
            );
          }
          return (
            <h4 key={key} className={className}>
              {content}
            </h4>
          );
        }

        if (block.kind === 'list') {
          const items = block.items.map((item, itemIndex) => (
            <li key={`${key}-i${itemIndex}`} className="mt-1">
              {renderInline(item, anchors, `${key}-i${itemIndex}`)}
            </li>
          ));
          return block.ordered ? (
            <ol key={key} className="mt-3 list-decimal pl-5">
              {items}
            </ol>
          ) : (
            <ul key={key} className="mt-3 list-disc pl-5">
              {items}
            </ul>
          );
        }

        return <p key={key}>{renderInline(block.text, anchors, key)}</p>;
      })}
    </div>
  );
}

/**
 * Fires `verification_viewed`. Rendered whether or not a narrative exists, so
 * the analytics answer the question "did anyone want one here" as well as
 * "did anyone read one".
 */
export function VerificationTracker({
  entityId,
  cached,
  reportAgeDays,
}: {
  entityId: string;
  cached: boolean;
  reportAgeDays: number | null;
}) {
  useEffect(() => {
    track('verification_viewed', {
      entity_id: entityId,
      cached,
      report_age_days: reportAgeDays,
    });
  }, [entityId, cached, reportAgeDays]);

  return null;
}
