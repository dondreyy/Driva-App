import { NextRequest, NextResponse } from 'next/server';

/** Sends anyone without a staff session to the sign in page. */
export function middleware(req: NextRequest) {
  if (!req.cookies.has('driva_admin_refresh')) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/', '/vetting/:path*'] };
