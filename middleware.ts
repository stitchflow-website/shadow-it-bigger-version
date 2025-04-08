import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Define paths that don't require authentication
const PUBLIC_PATHS = [
  '/login', 
  '/auth/google',
  '/api/auth/google'  // Add the API route for OAuth callback
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

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  
  // Debug cookie info
  console.log(`Middleware path: ${path}`);
  console.log(`Cookies: ${request.cookies.toString()}`);
  
  // Get authentication cookies
  const orgId = request.cookies.get('orgId')?.value;
  const userEmail = request.cookies.get('userEmail')?.value;
  
  console.log(`orgId cookie: ${orgId}`);
  console.log(`userEmail cookie: ${userEmail}`);
  
  // Check if the user is authenticated
  const isAuthenticated = orgId && userEmail;
  console.log(`isAuthenticated: ${isAuthenticated}`);

  // Check if the path is for a public file
  const isPublicFile = PUBLIC_FILE_PATTERNS.some(pattern => pattern.test(path));
  if (isPublicFile) {
    return NextResponse.next();
  }

  // Check if the path is public
  const isPublicPath = PUBLIC_PATHS.some(publicPath => 
    path === publicPath || path.startsWith(publicPath)
  );
  
  console.log(`isPublicPath: ${isPublicPath}, orgId: ${orgId}, userEmail: ${userEmail}`);
  
  // Skip middleware completely for API routes other than auth
  if (path.startsWith('/api') && !path.startsWith('/api/auth')) {
    return NextResponse.next();
  }
  
  // Direct authenticated users to dashboard if they try to access login
  if (isAuthenticated && path === '/login') {
    console.log('Authenticated user on login page, redirecting to dashboard');
    const url = new URL('/', request.url);
    url.searchParams.set('orgId', orgId);
    return NextResponse.redirect(url);
  }
  
  // Direct unauthenticated users to login if they try to access protected routes
  if (!isAuthenticated && !isPublicPath) {
    console.log('Unauthenticated user on protected route, redirecting to login');
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // For authenticated users on all other paths, proceed and add headers
  const response = NextResponse.next();
  if (orgId) {
    response.headers.set('x-organization-id', orgId);
  }
  if (userEmail) {
    response.headers.set('x-user-email', userEmail);
  }

  return response;
}

// Configure the paths that middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * 1. _next/static (static files)
     * 2. _next/image (image optimization files)
     * 3. favicon.ico (favicon file)
     * 4. public folder
     * 5. images in various formats
     */
    '/((?!_next/static|_next/image|favicon.ico|public/|assets/|images/|.*\\.(?:jpg|jpeg|gif|png|svg|ico)$).*)',
  ],
}; 