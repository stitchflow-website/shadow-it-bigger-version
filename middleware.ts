import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Define paths that don't require authentication
const PUBLIC_PATHS = [
  '/login', 
  '/loading',
  '/privacy',
  '/terms',
  '/auth/google',
  '/api/auth/google',  // Add the API route for OAuth callback
  '/api/background/sync', // Allow background sync API
];
const PUBLIC_FILE_PATTERNS = [
  /\.(?:jpg|jpeg|gif|png|svg|ico)$/,  // images
  /^\/public\//,                       // public folder
  /^\/images\//,                       // images folder
  /^\/assets\//,                       // assets folder
  /^\/favicon\.ico$/,                  // favicon
  /^\/robots\.txt$/,                   // robots.txt
  /^\/manifest\.json$/,                // manifest file
];

// This function runs on every request
export async function middleware(request: NextRequest) {
  console.log('Middleware path:', request.nextUrl.pathname);
  
  // Skip auth check for public routes
  const publicRoutes = [
    '/login',
    '/api/auth/google',
    '/api/auth/microsoft',
    '/api/auth/session',
    '/loading', // Add loading page to public routes
    '/google-logo.svg',
    '/microsoft-logo.svg',
    '/privacy',
    '/terms',
  ];
  
  // Check if current URL is a public route
  const isPublicRoute = publicRoutes.some(route => 
    request.nextUrl.pathname === route || request.nextUrl.pathname.startsWith(route)
  );
  
  // Just check for the presence of user_info cookie for now
  const userInfo = request.cookies.get('user_info')?.value;
  const isAuthenticated = !!userInfo;
  
  console.log('isAuthenticated:', isAuthenticated, 'isPublicRoute:', isPublicRoute);
  
  // Redirect logic
  if (!isAuthenticated && !isPublicRoute) {
    // Redirect to login page if not authenticated and trying to access protected route
    return NextResponse.redirect(new URL('/login', request.url));
  }
  
  if (isAuthenticated && request.nextUrl.pathname === '/login') {
    // Redirect to home page if already authenticated and trying to access login page
    return NextResponse.redirect(new URL('/', request.url));
  }
  
  // Continue with the request
  return NextResponse.next();
}

// Configure which routes use this middleware
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
}; 