'use client';

import { useState } from 'react';
import { Check, Code2 } from 'lucide-react';
import { Icon } from '@/components/icon';
import { useStrings } from '@/components/locale-provider';
import { track } from '@/lib/analytics';

/**
 * The copy-the-iframe-snippet widget (docs/07, the newsroom embeds line).
 *
 * The snippet is assembled server-side and passed in whole, because the site
 * origin lives in server configuration and this component must not pull the
 * data layer into the client bundle to learn it. Copying is the shareable act,
 * so it is the tracked event, on the same channel taxonomy as the share cards.
 */

const EMBED_HEIGHT = 360;

export function buildEmbedSnippet(src: string, title: string): string {
  return [
    `<iframe src="${src}"`,
    `  width="100%" height="${EMBED_HEIGHT}"`,
    `  style="border: 1px solid #9aa5a0; max-width: 640px;"`,
    `  title="${title.replace(/"/g, '&quot;')}"`,
    `  loading="lazy"></iframe>`,
  ].join('\n');
}

export function EmbedCode({
  src,
  title,
  entityId,
}: {
  /** Absolute URL of the embed route, origin included. */
  src: string;
  /** Accessible title for the iframe, usually the entity name. */
  title: string;
  entityId: string;
}) {
  const strings = useStrings();
  const [copied, setCopied] = useState(false);
  const snippet = buildEmbedSnippet(src, title);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      track('share_card_generated', { entity_id: entityId, channel: 'embed' });
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('[embed-code] could not write to the clipboard', error);
    }
  }

  return (
    <div className="border border-[color:var(--color-rule-strong)]">
      <pre className="overflow-x-auto bg-[color:var(--color-paper-sunk)] px-4 py-3 text-[12px] leading-relaxed">
        <code>{snippet}</code>
      </pre>
      <div className="flex items-center justify-between gap-3 border-t border-[color:var(--color-rule)] px-4 py-2">
        <p className="text-[12px] text-[color:var(--color-ink-faint)]">{strings.state.embedHelp}</p>
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1.5 border border-[color:var(--color-rule-strong)] px-3 py-1.5 text-[13px] text-[color:var(--color-ink-soft)] transition-colors hover:text-[color:var(--color-ink)]"
        >
          <Icon icon={copied ? Check : Code2} size="sm" />
          {copied ? strings.embed.copied : strings.embed.copy}
        </button>
      </div>
    </div>
  );
}
