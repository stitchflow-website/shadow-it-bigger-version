import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// For client components to get session info
export async function getSessionInfo() {
  try {
    const response = await fetch('/api/auth/session');
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    console.error('Error getting session info:', error);
    return null;
  }
}
