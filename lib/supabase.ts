import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Client for public queries (limited access)
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: {
    schema: 'shadow_it'
  }
});

// Admin client for server-side operations (full access)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  db: {
    schema: 'shadow_it'
  }
});

// Type definitions for your tables
export type Organization = {
  id: string;
  google_org_id: string;
  name: string;
  domain: string;
  created_at: string;
  updated_at: string;
}

export type Application = {
  id: string;
  google_app_id: string;
  name: string;
  category: string;
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW';
  management_status: 'APPROVED' | 'PENDING' | 'BLOCKED';
  total_permissions: number;
  all_scopes: string[];
  last_login: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
}

export type User = {
  id: string;
  google_user_id: string;
  email: string;
  name: string;
  role: string | null;
  department: string | null;
  organization_id: string;
  last_login: string | null;
  created_at: string;
  updated_at: string;
}

export type UserApplication = {
  id: string;
  user_id: string;
  application_id: string;
  scopes: string[];
  last_login: string;
  created_at: string;
  updated_at: string;
}

export type UserSignedUp = {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  last_login: string | null;
  created_at: string;
  updated_at: string;
} 