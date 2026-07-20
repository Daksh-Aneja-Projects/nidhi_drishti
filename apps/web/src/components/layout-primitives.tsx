import type { LucideIcon } from 'lucide-react';
import { Link } from '@/components/locale-link';
import { Icon } from '@/components/icon';

/**
 * Layout primitives shared by every page.
 *
 * The page model is a register: a stack of ruled bands, each one a record with
 * its label at the left and its figures right-aligned. Rules are structural
 * here, marking where one record ends and the next begins, which is why there
 * are no cards, no shadows and no rounded containers in this system.
 */

export function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[90rem] px-4 py-8 sm:px-6">{children}</div>;
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b-2 border-[color:var(--color-rule-strong)] pb-5">
      <div>
        {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
        <h1 className="font-display text-[clamp(1.75rem,4vw,2.75rem)] leading-[1.1]">{title}</h1>
        {lede ? (
          <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-[color:var(--color-ink-soft)]">
            {lede}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
    </div>
  );
}

export function Section({
  title,
  help,
  actions,
  children,
  id,
}: {
  title: string;
  help?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="mt-10 first:mt-0">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-[color:var(--color-rule-strong)] pb-2">
        <div>
          <h2 className="font-display text-lg leading-tight">{title}</h2>
          {help ? (
            <p className="mt-1 max-w-[68ch] text-[13px] leading-snug text-[color:var(--color-ink-faint)]">
              {help}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A single ruled record in the register. */
export function Band({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return <div className={strong ? 'band-strong py-4' : 'band py-4'}>{children}</div>;
}

/**
 * Empty state. Never an emoji, never an apology, always a way forward
 * (docs/06 rule 1 and the writing guidance: an empty screen is an invitation).
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="border border-dashed border-[color:var(--color-rule-strong)] px-6 py-10 text-center">
      {icon ? (
        <Icon icon={icon} size="lg" className="mb-3 text-[color:var(--color-ink-faint)]" />
      ) : null}
      <p className="font-display text-base">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-[color:var(--color-ink-faint)]">
        {body}
      </p>
      {action ? (
        <Link
          href={action.href}
          className="mt-4 inline-block border-b border-[color:var(--color-behind)] pb-0.5 text-[13px] font-medium text-[color:var(--color-behind)]"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * A caveat set off from the surrounding content.
 *
 * `note` for context, `caution` for the lines that keep the product honest:
 * what a signal does not establish, why a figure is partial, why an AI
 * narrative is not an official reconciliation.
 */
export function Callout({
  tone = 'note',
  title,
  children,
}: {
  tone?: 'note' | 'caution';
  title?: string;
  children: React.ReactNode;
}) {
  const accent = tone === 'caution' ? 'var(--color-seal)' : 'var(--color-rule-strong)';
  return (
    <div
      className="border-l-2 bg-[color:var(--color-paper-sunk)] px-4 py-3"
      style={{ borderColor: accent }}
    >
      {title ? <p className="eyebrow mb-1">{title}</p> : null}
      <div className="text-[13px] leading-relaxed text-[color:var(--color-ink-soft)]">
        {children}
      </div>
    </div>
  );
}

/** Horizontally scrollable table wrapper. Journalists read this on phones. */
export function TableScroll({ children }: { children: React.ReactNode }) {
  return <div className="table-scroll">{children}</div>;
}

/** Small metadata chip, for stage labels and match confidence. */
export function Chip({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'seal' | 'muted';
}) {
  const styles = {
    neutral: 'border-[color:var(--color-rule-strong)] text-[color:var(--color-ink-soft)]',
    seal: 'border-[color:var(--color-seal)] text-[color:var(--color-seal)]',
    muted: 'border-[color:var(--color-rule)] text-[color:var(--color-ink-faint)]',
  }[tone];
  return (
    <span
      className={`inline-block border px-1.5 py-px text-[10px] font-medium uppercase tracking-wider ${styles}`}
    >
      {children}
    </span>
  );
}
