import { GlideApp } from '@/components/GlideApp';
import { extractUrl } from '@/lib/form';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** `?url=`, or the Web Share Target params (`url`, `text`, `title`). */
export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const shared = extractUrl(one(sp.url), one(sp.text), one(sp.title));
  return <GlideApp sharedUrl={shared || undefined} />;
}
