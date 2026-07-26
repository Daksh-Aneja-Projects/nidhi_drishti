import { NextResponse, type NextRequest } from 'next/server';
import {
  HI_PREFIX,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  PATH_HEADER,
  splitLocalePath,
} from '@/lib/i18n';

/**
 * Locale routing.
 *
 * The `/hi` path prefix is the single source of truth for language. This
 * middleware:
 *   1. reads the locale off the URL prefix,
 *   2. rewrites `/hi/foo` to the underlying `/foo` route so every page stays a
 *      single file rather than a duplicated `[locale]` tree, while the browser
 *      URL keeps the `/hi` prefix (needed for indexing and hreflang),
 *   3. hands the resolved locale and the English-canonical path to the page via
 *      request headers, so server components render the right language from the
 *      first byte with no flash of English,
 *   4. remembers the reader's choice in a cookie and, only for a bare visit to
 *      the root, redirects a returning Hindi reader to `/hi`. Crawlers send no
 *      cookie, so they always receive the canonical English root with hreflang
 *      alternates: one URL still maps to one language for indexing.
 */

const YEAR_SECONDS = 60 * 60 * 24 * 365;

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const [locale, canonicalPath] = splitLocalePath(pathname);

  // Returning Hindi reader landing on the bare root. Cookie-driven and so only
  // ever affects real browsers; search engines keep seeing English at `/`.
  if (pathname === '/' && request.cookies.get(LOCALE_COOKIE)?.value === 'hi') {
    const url = request.nextUrl.clone();
    url.pathname = HI_PREFIX;
    return NextResponse.redirect(url);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(LOCALE_HEADER, locale);
  requestHeaders.set(PATH_HEADER, canonicalPath);

  let response: NextResponse;
  if (locale === 'hi') {
    const url = request.nextUrl.clone();
    url.pathname = canonicalPath;
    response = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  // The newsroom embeds exist to be iframed into other sites, which the
  // site-wide X-Frame-Options: SAMEORIGIN (next.config.ts) would forbid.
  // `frame-ancestors` is the successor to X-Frame-Options and browsers that
  // support it ignore X-Frame-Options when it is present, so setting it here
  // opens exactly the `/embed` routes to framing while every other page keeps
  // the same-origin rule.
  if (canonicalPath === '/embed' || canonicalPath.startsWith('/embed/')) {
    response.headers.set('Content-Security-Policy', 'frame-ancestors *');
    response.headers.delete('X-Frame-Options');
  }

  response.cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: YEAR_SECONDS,
    sameSite: 'lax',
  });
  return response;
}

export const config = {
  // Run on page routes only. Skip the API, Next internals, and any path with a
  // file extension (feeds are `.xml`, share cards are served as images, etc.).
  matcher: ['/((?!api|_next/static|_next/image|.*\\..*).*)'],
};
