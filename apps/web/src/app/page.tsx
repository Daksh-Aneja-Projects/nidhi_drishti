import { PageHeader, PageShell } from '@/components/layout-primitives';
import { strings } from '@/lib/strings';

export default function HomePage() {
  return (
    <PageShell>
      <PageHeader
        eyebrow={strings.overview.heroEyebrow}
        title={strings.site.tagline}
        lede={strings.site.description}
      />
    </PageShell>
  );
}
