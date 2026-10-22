import { getClaimsCached } from "@/lib/supabase/claims";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Auth guard (Next 16 "proxy", formerly middleware): refreshes the session, redirects anonymous users to /login. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getClaims validates the JWT; never trust getSession() on the server.
  const { data } = await getClaimsCached(supabase);
  const signedIn = !!data?.claims;
  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/login" || pathname.startsWith("/login/");

  if (!signedIn && pathname.startsWith("/api/")) {
    // Fetch callers need a status code they can act on, not an HTML redirect.
    return NextResponse.json({ ok: false, error: { code: "unauthorized", message: "Please sign in again" } }, { status: 401 });
  }
  if (!signedIn && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (signedIn && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Skip Next internals and static assets (PWA manifest / service worker / OCR assets included).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|tesseract|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|css|json|wasm|traineddata|gz)$).*)",
  ],
};
