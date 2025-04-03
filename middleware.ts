import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  try {
    // const res = NextResponse.next();
    
    // // Initialize Supabase client
    // const supabase = createMiddlewareClient({ req: request, res });

    // const { data: { session } } = await supabase.auth.getSession();

    // // If there's no session and the user is trying to access a protected route
    // if (!session && !request.nextUrl.pathname.startsWith('/login')) {
    //   const redirectUrl = new URL('/login', request.url);
    //   return NextResponse.redirect(redirectUrl);
    // }

    // // If there's a session and the user is on the login page
    // if (session && request.nextUrl.pathname.startsWith('/login')) {
    //   const redirectUrl = new URL('/', request.url);
    //   return NextResponse.redirect(redirectUrl);
    // }

    // return res;
  } catch (error) {
    console.error('Middleware error:', error);
    // On error, allow the request to continue
    return NextResponse.next();
  }
}

// Update matcher to exclude auth callback route
export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico).*)',
  ],
}; 