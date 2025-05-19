"use client"

import React, { useState, useEffect, useMemo, useRef } from "react"
import {
  User,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  BarChart3,
  ArrowLeft,
  Info,
  CheckCircle,
  AlertTriangle,
  LayoutGrid,
  Settings,
  X,
  Eye,
  LogOut,
  ExternalLink,
  ScanSearch,
  LayoutDashboard,
  BellRing,
  ShieldAlert,
  ChartNoAxesCombined,
  Bell,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { WhyStitchflow } from "@/components/ui/demo";
import { Button } from "@/components/ui/button"
import Link from 'next/link';
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "@/components/ui/chart"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { JSX } from "react"
import { useDebounce } from "@/app/hooks/useDebounce"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { FAQ } from "@/components/ui/faq"
import { FeedbackChat } from "@/components/ui/feedback";
import { Share } from "@/components/ui/share";
// Import the new SettingsModal component
import SettingsModal from "@/app/components/SettingsModal";
// Import risk assessment utilities
import { HIGH_RISK_SCOPES, MEDIUM_RISK_SCOPES } from "@/lib/risk-assessment";
import { supabaseAdmin } from '@/lib/supabase';
import { determineRiskLevel, transformRiskLevel, getRiskLevelColor, evaluateSingleScopeRisk, RiskLevel } from '@/lib/risk-assessment'; // Corrected import alias and added type import
import { useSearchParams } from "next/navigation"

// Type definitions
type Application = {
  id: string
  name: string
  category: string | null // Modified to allow null
  userCount: number
  users: AppUser[]
  riskLevel: RiskLevel
  riskReason: string
  totalPermissions: number
  scopeVariance: { userGroups: number; scopeGroups: number }
  logoUrl?: string      // Primary logo URL
  logoUrlFallback?: string // Fallback logo URL
  created_at?: string   // Added created_at field
  managementStatus: "Managed" | "Unmanaged" | "Needs Review"
  ownerEmail: string
  notes: string
  scopes: string[]
  isInstalled: boolean
  isAuthAnonymously: boolean
  isCategorizing?: boolean // Added to track categorization status
}

type AppUser = {
  id: string
  appId: string
  name: string
  email: string
  lastActive?: string
  created_at?: string
  scopes: string[]
  riskLevel: RiskLevel
  riskReason: string
}

// Sort types
type SortColumn =
  | "name"
  | "category"
  | "userCount"
  | "riskLevel"
  | "totalPermissions"
  // | "lastLogin" // Removed
  | "managementStatus"
  | "highRiskUserCount" // Added for the new column
type SortDirection = "asc" | "desc"

// User table sort types
type UserSortColumn = "name" | "email" | "created" | "riskLevel"

// Chart data types
type CategoryData = {
  name: string
  value: number
  color: string
}

type BarChartData = {
  name: string
  users: number
  apps: number
}

type RiskData = {
  name: string
  value: number
  color: string
}

const X_AXIS_HEIGHT = 30;
const Y_AXIS_WIDTH = 150;
const CHART_TOTAL_HEIGHT = 384; // Corresponds to h-96
const BAR_VIEWPORT_HEIGHT = CHART_TOTAL_HEIGHT - X_AXIS_HEIGHT;
const BAR_THICKNESS_WITH_PADDING = 30;

export default function ShadowITDashboard() {
  const router = useRouter();
  const [applications, setApplications] = useState<Application[]>([])
  const [searchInput, setSearchInput] = useState("")
  const [filterCategory, setFilterCategory] = useState<string | null>(null)
  const [filterRisk, setFilterRisk] = useState<string | null>(null)
  const [filterManaged, setFilterManaged] = useState<string | null>(null)
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null)
  const [isUserModalOpen, setIsUserModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [userSearchTerm, setUserSearchTerm] = useState("")
  const [editedStatuses, setEditedStatuses] = useState<Record<string, string>>({})
  const [mainView, setMainView] = useState<"list" | "Insights">("list")
  const [currentPage, setCurrentPage] = useState(1)
  const [userCurrentPage, setUserCurrentPage] = useState(1)
  const [scopeCurrentPage, setScopeCurrentPage] = useState(1)
  const itemsPerPage = 20

  // Sorting state - default to showing apps with highest risk and most users at top
  const [sortColumn, setSortColumn] = useState<SortColumn>("riskLevel")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

  const [userSortColumn, setUserSortColumn] = useState<"name" | "email" | "created" | "riskLevel">("name")
  const [userSortDirection, setUserSortDirection] = useState<SortDirection>("desc")

  const searchTerm = useDebounce(searchInput, 300)
  const debouncedUserSearchTerm = useDebounce(userSearchTerm, 300)

  // Add new state for settings
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const [authProvider, setAuthProvider] = useState<'google' | 'microsoft' | null>(null);

  const [isPolling, setIsPolling] = useState(false)
  const [uncategorizedApps, setUncategorizedApps] = useState<Set<string>>(new Set())
  const [appCategories, setAppCategories] = useState<Record<string, string>>({})
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);

  const [userInfo, setUserInfo] = useState<{ name: string; email: string; avatar_url: string | null } | null>(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // Add this state near your other useState declarations
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginError, setLoginError] = useState<string>('');
  
  // State for the "Top Apps by User Count" chart's managed status filter
  const [chartManagedStatusFilter, setChartManagedStatusFilter] = useState<string>('Any Status');

  // State for the "High Risk Users by App" chart's managed status filter
  const [highRiskUsersManagedStatusFilter, setHighRiskUsersManagedStatusFilter] = useState<string>('Any Status');

  // State for the "Apps by Scope Permissions" chart's managed status filter
  const [scopePermissionsManagedStatusFilter, setScopePermissionsManagedStatusFilter] = useState<string>('Any Status');

  const searchParams = useSearchParams(); // Import and use useSearchParams
  const mainContentRef = useRef<HTMLDivElement>(null); // Added for scroll to top

  // Add states for owner email and notes editing
  const [ownerEmail, setOwnerEmail] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<{type: "success" | "error", text: string} | null>(null);

  // Helper function to redirect to Google consent screen
  const redirectToGoogleConsent = () => {
    let redirectURI;
    
    // Check if we're on localhost
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname.includes('127.0.0.1'))) {
      redirectURI = `${window.location.origin}/tools/shadow-it-scan/api/auth/google/callback`;
    } else {
      redirectURI = `https://stitchflow.com/tools/shadow-it-scan/api/auth/google`;
    }
    
    const scopes = [
      'openid',
      'profile',
      'email',
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
      'https://www.googleapis.com/auth/admin.directory.domain.readonly',
      'https://www.googleapis.com/auth/admin.directory.user.security',
    ];
    
    const state = Math.random().toString(36).substring(2, 15);
    localStorage.setItem('oauth_state', state);
    localStorage.setItem('auth_provider', 'google');
    
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.append('client_id', process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '');
    url.searchParams.append('redirect_uri', redirectURI);
    url.searchParams.append('response_type', 'code');
    url.searchParams.append('scope', scopes.join(' '));
    url.searchParams.append('access_type', 'offline');
    url.searchParams.append('state', state);
    url.searchParams.append('prompt', 'consent');
    
    console.log("Redirecting to Google with URI:", redirectURI);
    window.location.href = url.toString();
  };
  
  // Helper function to redirect to Microsoft consent screen
  const redirectToMicrosoftConsent = () => {
    let redirectURI;
    
    // Check if we're on localhost
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname.includes('127.0.0.1'))) {
      redirectURI = `${window.location.origin}/tools/shadow-it-scan/api/auth/microsoft/callback`;
    } else {
      redirectURI = `https://stitchflow.com/tools/shadow-it-scan/api/auth/microsoft`;
    }
    
    const scopes = [
      'user.read',
      'User.ReadBasic.All',
      'Directory.Read.All'
    ];
    
    const state = Math.random().toString(36).substring(2, 15);
    localStorage.setItem('oauth_state', state);
    localStorage.setItem('auth_provider', 'microsoft');
    
    const url = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    url.searchParams.append('client_id', process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID || '');
    url.searchParams.append('redirect_uri', redirectURI);
    url.searchParams.append('response_type', 'code');
    url.searchParams.append('scope', scopes.join(' '));
    url.searchParams.append('state', state);
    url.searchParams.append('prompt', 'consent');
    
    console.log("Redirecting to Microsoft with URI:", redirectURI);
    window.location.href = url.toString();
  };
  
  // Add a useEffect to check for error parameters in the URL
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const errorParam = searchParams.get('error');

    if (errorParam) {
      const provider = localStorage.getItem('auth_provider') as 'google' | 'microsoft' | null;

      const needsDirectConsentErrors = [
        'interaction_required',
        'login_required',
        'consent_required',
        'missing_data',
        'data_refresh_required'
      ];
      const isDirectConsentError = needsDirectConsentErrors.includes(errorParam);

      if (isDirectConsentError && provider) {
        console.log(`Redirecting directly to ${provider} consent screen due to error: ${errorParam}`);
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('error');
        window.history.replaceState({}, document.title, cleanUrl.toString());

        if (provider === 'google') {
          redirectToGoogleConsent();
        } else if (provider === 'microsoft') {
          redirectToMicrosoftConsent();
        }
        return; // Exit after redirecting
      }

      let friendlyMessage = '';
        switch (errorParam) {
          case 'admin_required':
            friendlyMessage = "Please use an admin workspace account as personal accounts are not supported.";
            break;
          case 'not_workspace_account':
            friendlyMessage = "Please use an admin workspace account as personal accounts are not supported.";
            break;
          case 'not_work_account':
            friendlyMessage = "Please use an admin workspace account as personal accounts are not supported.";
            break;
          case 'no_code':
            friendlyMessage = "Authentication failed: Authorization code missing. Please try again. Check you mail for detailed error message.";
            break;
          case 'auth_failed':
            friendlyMessage = "Authentication failed. Please try again or reach out to contact@stitchflow.io if the issue persists.";
            break;
          case 'user_data_failed':
            friendlyMessage = "Failed to fetch user data after authentication. Please try again.";
            break;
          case 'config_missing':
            friendlyMessage = "OAuth configuration is missing. Please reach out to contact@stitchflow.io.";
            break;
          case 'data_refresh_required': // Also in needsDirectConsentErrors
            // If provider was missing, this message will be shown.
            friendlyMessage = "We need to refresh your account permissions. Please sign in again to grant access.";
            break;
          // Cases for interaction_required, login_required, consent_required, missing_data
          // are handled by the default block below if they were a 'isDirectConsentError' but provider was null.
          case 'interaction_required':
          case 'login_required':
          case 'consent_required':
          case 'missing_data':
          case 'unknown':
          default:
            if (isDirectConsentError) { // Error was a direct consent type, but provider was null (so no redirect)
              friendlyMessage = 'We need to refresh your data access. Please grant permission again.';
            } else {
              friendlyMessage = "An unknown authentication error occurred. Please try again.";
            }
            break;
        }
        
      setLoginError(friendlyMessage);
      setShowLoginModal(true);

      // Clean up the URL by removing the error parameter
      const cleanUrl = new URL(window.location.href);
      if (cleanUrl.searchParams.has('error')) {
          cleanUrl.searchParams.delete('error');
          window.history.replaceState({}, document.title, cleanUrl.toString());
      }
    }
  }, [searchParams, redirectToGoogleConsent, redirectToMicrosoftConsent, setLoginError, setShowLoginModal]);

  // Add new function to check categories
  const checkCategories = async () => {
    try {
      let categoryOrgId: string | null = null;
      
      // Only run client-side code in browser environment
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        categoryOrgId = urlParams.get('orgId');
        
        if (!categoryOrgId) {
          try {
            const cookies = document.cookie.split(';');
            const orgIdCookie = cookies.find(cookie => cookie.trim().startsWith('orgId='));
            if (orgIdCookie) {
              categoryOrgId = orgIdCookie.split('=')[1].trim();
            }
          } catch (cookieError) {
            console.error("Error parsing cookies:", cookieError);
          }
        }
        
        if (!categoryOrgId) return;
      } else {
        // Skip this function on the server
        return;
      }

      // Only fetch categories for uncategorized apps
      const uncategorizedIds = Array.from(uncategorizedApps);
      if (uncategorizedIds.length === 0) return;

      const response = await fetch(`/tools/shadow-it-scan/api/applications/categories?ids=${uncategorizedIds.join(',')}&orgId=${categoryOrgId}`);
      if (!response.ok) return;

      const data = await response.json();
      
      // Update only the categories state
      setAppCategories(prev => ({ ...prev, ...data }));
      
      // Remove categorized apps from uncategorized set
      setUncategorizedApps(prev => {
        const next = new Set(prev);
        Object.entries(data).forEach(([id, category]) => {
          if (category && category !== 'Unknown') {
            next.delete(id);
          }
        });
        return next;
      });
    } catch (error) {
      console.error("Error checking categories:", error);
    }
  };

  // Modify the polling effect to use checkCategories
  useEffect(() => {
    if (uncategorizedApps.size > 0) {
      pollingInterval.current = setInterval(checkCategories, 5000) as NodeJS.Timeout;
    } else {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
        pollingInterval.current = null;
      }
    }
    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
        pollingInterval.current = null;
      }
    };
  }, [uncategorizedApps]);

  // Modify fetchData to only set initial data
  const fetchData = async () => {
    try {
      setIsLoading(true);
      
      // Check URL parameters for orgId (which might be set during OAuth redirect)
      let fetchOrgId = null;
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const urlOrgId = urlParams.get('orgId');
        
        if (urlOrgId) {
          fetchOrgId = urlOrgId;
        } else if (document.cookie.split(';').find(cookie => cookie.trim().startsWith('orgId='))) {
          const orgIdCookie = document.cookie.split(';').find(cookie => cookie.trim().startsWith('orgId='));
          fetchOrgId = orgIdCookie?.split('=')[1].trim();
        }
      }
      
      // Only load dummy data if not authenticated
      if (!isAuthenticated()) {
        console.log('Not authenticated, loading dummy data');
        // Use dummy data if no cookies found
        const dummyData = [
          {
            "Apps": "Slack",
            "Category": "Productivity & Collaboration",
            "Users": [
              "Adam Williams",
              "Ashley Parker",
              "Brooke Evans",
              "Daniel Carter",
              "Diana Myers",
              "Donna Reynolds",
              "Grace Henderson",
              "Julia Scott",
              "Jack Thompson",
              "James Bennett",
              "Joseph Brooks",
              "Kevin Anderson",
              "Matthew Collins",
              "Nathan Harris",
              "Peter Russell",
              "Patrick Walsh",
              "Paul Simmons",
              "Ryan Mitchell",
              "Sandbox User",
              "Samuel Hayes",
              "Steven Morgan",
              "Shane Robinson",
              "Sara Price",
              "Victoria Barnes",
              "Taylor Monroe",
              "Thomas Greene",
              "Vanessa Reed",
              "Valerie Patterson",
              "Violet Richardson"
            ],
            "Scopes": [
              "https://www.googleapis.com/auth/userinfo.profile",
              "https://www.googleapis.com/auth/userinfo.email",
              "openid",
              "https://www.googleapis.com/auth/calendar.events",
              "https://www.googleapis.com/auth/activity",
              "https://www.googleapis.com/auth/drive.activity",
              "https://www.googleapis.com/auth/calendar.readonly",
              "https://www.googleapis.com/auth/drive",
              "https://www.googleapis.com/auth/admin.directory.group.readonly",
              "https://www.googleapis.com/auth/admin.directory.group.member.readonly",
              "https://www.googleapis.com/auth/admin.directory.user.readonly"
            ],
            "Total Scopes": 11,
            "Risk": "High",
            "Status": "Managed"
          },
          {
            "Apps": "HubSpot",
            "Category": "Sales & Marketing",
            "Users": [
              "Peter Russell",
              "Ashley Parker",
              "Adam Williams",
              "Andrew Patterson",
              "Grace Henderson",
              "Joseph Brooks",
              "Jack Thompson",
              "James Bennett",
              "Kevin Anderson",
              "Matthew Collins",
              "Nathan Harris",
              "Ryan Mitchell",
              "Ray Smith",
              "Sandbox User",
              "Samuel Hayes",
              "Shane Robinson",
              "Victoria Barnes",
              "Sandbox User",
              "Taylor Monroe",
              "Thomas Greene"
            ],
            "Scopes": [
              "https://www.googleapis.com/auth/userinfo.profile",
              "https://www.googleapis.com/auth/userinfo.email",
              "openid",
              "https://www.googleapis.com/auth/calendar.events",
              "https://www.googleapis.com/auth/calendar.readonly",
              "https://www.googleapis.com/auth/gmail.readonly",
              "https://www.googleapis.com/auth/gmail.send"
            ],
            "Total Scopes": 7,
            "Risk": "High",
            "Status": "Managed"
          },
          {
            "Apps": "Kandji",
            "Category": "Identity & Access Management",
            "Users": [
              "Ashley Parker",
              "Peter Russell",
              "Shane Robinson",
              "Taylor Monroe"
            ],
            "Scopes": [
              "https://www.googleapis.com/auth/userinfo.profile",
              "https://www.googleapis.com/auth/userinfo.email",
              "openid",
              "https://www.googleapis.com/auth/admin.directory.group.readonly",
              "https://www.googleapis.com/auth/admin.directory.user.readonly"
            ],
            "Total Scopes": 5,
            "Risk": "High",
            "Status": "Managed"
          },
          {
            "Apps": "ClickUp",
            "Category": "Productivity & Collaboration",
            "Users": [
              "Ashley Parker",
              "Diana Myers",
              "Grace Henderson",
              "Julia Scott",
              "Jack Thompson",
              "James Bennett",
              "Samuel Hayes",
              "Thomas Greene",
              "Vanessa Reed"
            ],
            "Scopes": [
              "https://www.googleapis.com/auth/userinfo.profile",
              "https://www.googleapis.com/auth/userinfo.email",
              "openid",
              "https://www.googleapis.com/auth/calendar"
            ],
            "Total Scopes": 4,
            "Risk": "Medium",
            "Status": "Unmanaged"
          },
          {
            "Apps": "Zoom",
            "Category": "Productivity & Collaboration",
            "Users": [
              "Adam Williams",
              "Ashley Parker",
              "Victor Sanders",
              "Brooke Evans",
              "Daniel Carter",
              "Diana Myers",
              "Donna Reynolds",
              "Grace Henderson",
              "Julia Scott",
              "Joseph Brooks",
              "Jack Thompson",
              "James Bennett",
              "Joseph Brooks",
              "Kevin Anderson",
              "Matthew Collins",
              "Peter Russell",
              "Patrick Walsh",
              "Sandbox User",
              "Samuel Hayes",
              "Shane Robinson",
              "Sara Price",
              "Victoria Barnes",
              "Taylor Monroe",
              "Thomas Greene",
              "Vanessa Reed",
              "Valerie Patterson"
            ],
            "Scopes": [
              "https://www.googleapis.com/auth/userinfo.profile",
              "https://www.googleapis.com/auth/userinfo.email",
              "openid",
              "https://www.googleapis.com/auth/calendar.events",
              "https://www.googleapis.com/auth/contacts",
              "https://www.googleapis.com/auth/calendar"
            ],
            "Total Scopes": 6,
            "Risk": "Medium",
            "Status": "Managed"
          },
          {
            "Apps": "Docker",
            "Category": "Cloud Platforms & Infrastructure",
            "Users": [
              "Brooke Evans",
              "Peter Russell",
              "Patrick Walsh"
            ],
            "Scopes": [
              "https://www.googleapis.com/auth/userinfo.profile",
              "https://www.googleapis.com/auth/userinfo.email",
              "openid"
            ],
            "Total Scopes": 3,
            "Risk": "Low",
            "Status": "Needs Review"
          },
          {
            "Apps": "Strapi Cloud",
            "Category": "Cloud Platforms & Infrastructure",
            "Users": [
              "Samuel Hayes",
              "Sandbox User"
            ],
            "Scopes": [
              "https://www.googleapis.com/auth/userinfo.profile",
              "https://www.googleapis.com/auth/userinfo.email",
              "openid"
            ],
            "Total Scopes": 3,
            "Risk": "Low",
            "Status": "Unmanaged"
          },
          {
            "Apps": "Datadog",
            "Category": "IT Operations & Security",
            "Users": [
              "Brooke Evans",
              "Joseph Brooks",
              "Peter Russell",
              "Patrick Walsh",
              "Taylor Monroe",
              "Thomas Greene"
            ],
            "Scopes": [
              "https://www.googleapis.com/auth/userinfo.profile",
              "https://www.googleapis.com/auth/userinfo.email",
              "openid"
            ],
            "Total Scopes": 3,
            "Risk": "Low",
            "Status": "Managed"
          },
          {
            "Apps": "Looker Studio",
            "Category": "Analytics & Business Intelligence",
            "Users": [
              "Grace Henderson",
              "Paul Simmons"
            ],
            "Scopes": [
              "https://www.googleapis.com/auth/analytics.readonly",
              "https://www.googleapis.com/auth/webmasters.readonly",
              "https://www.googleapis.com/auth/userinfo.profile",
              "https://www.googleapis.com/auth/adwords",
              "https://www.googleapis.com/auth/drive"
            ],
            "Total Scopes": 5,
            "Risk": "High",
            "Status": "Unmanaged"
          },
          {
            "Apps": "Framer",
            "Category": "Design & Creative Tools",
            "Users": [
              "Adam Williams",
              "Nathan Harris",
              "Samuel Hayes",
              "Sandbox User"
            ],
            "Scopes": [
              "https://www.googleapis.com/auth/userinfo.profile",
              "https://www.googleapis.com/auth/userinfo.email",
              "openid",
              "https://www.googleapis.com/auth/drive.file"
            ],
            "Total Scopes": 4,
            "Risk": "High",
            "Status": "Needs Review"
          },
          {
            "Apps": "Canva",
            "Category": "Design & Creative Tools",
            "Users": [
              "Ashley Parker",
              "James Bennett",
              "Samuel Hayes",
              "Taylor Monroe"
            ],
            "Scopes": [
              "https://www.googleapis.com/auth/userinfo.profile",
              "https://www.googleapis.com/auth/userinfo.email",
              "openid"
            ],
            "Total Scopes": 3,
            "Risk": "Low",
            "Status": "Managed"
          },
          {
            "Apps": "Otter.ai",
            "Category": "Productivity & Collaboration",
            "Users": [
              "Ashley Parker",
              "Julia Scott",
              "Samuel Hayes",
              "Vanessa Reed"
            ],
            "Scopes": [
              "https://www.googleapis.com/auth/userinfo.profile",
              "https://www.googleapis.com/auth/userinfo.email",
              "openid",
              "https://www.googleapis.com/auth/calendar.readonly"
            ],
            "Total Scopes": 4,
            "Risk": "Medium",
            "Status": "Needs Review"
          }
        ]
        
        setApplications(transformDummyData(dummyData));
        setIsLoading(false);
        return;
      }

      const fetchOrgIdValue = fetchOrgId || '';
      const response = await fetch(`/tools/shadow-it-scan/api/applications?orgId=${fetchOrgIdValue}`);
      if (!response.ok) {
        throw new Error('Failed to fetch applications');
      }

      const rawData: Application[] = await response.json();
      // Process data to calculate user risk levels client-side
      const processedData = rawData.map(app => ({
        ...app,
        users: app.users.map(user => ({
          ...user,
          riskLevel: determineRiskLevel(user.scopes) // Calculate risk level for each user
        }))
      }));
      setApplications(processedData);
      
      // Track apps still uncategorized
      const unknownIds = new Set<string>();
      processedData.forEach((app: Application) => { // Use processedData here
        if (app.category === 'Unknown') unknownIds.add(app.id);
      });
      setUncategorizedApps(unknownIds);
      
      setIsLoading(false);
    } catch (error) {
      console.error("Error fetching application data:", error);
      setIsLoading(false);
      setApplications([]);
    }
  };

  // Add useEffect to trigger fetchData
  useEffect(() => {
    fetchData();
    
    // Cleanup function
    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
        pollingInterval.current = null;
      }
    };
  }, []); // Empty dependency array means this runs once on mount

  // Add error state if needed
  const [error, setError] = useState<string | null>(null);

  // Stop polling when all apps are categorized
  useEffect(() => {
    if (!isPolling && pollingInterval.current) {
      clearInterval(pollingInterval.current);
      pollingInterval.current = null;
    }
  }, [isPolling]);

  useEffect(() => {
    const provider = localStorage.getItem('auth_provider') as 'google' | 'microsoft' | null;
    setAuthProvider(provider);
  }, []);

  useEffect(() => {
    // Fetch user info directly from our new API endpoint
    const fetchUserData = async () => {
      try {
        const response = await fetch('/tools/shadow-it-scan/api/session-info');
        
        if (response.ok) {
          const userData = await response.json();
          setUserInfo(userData);
          console.log('User data fetched successfully:', userData);
        } else {
          console.error('Failed to fetch user data, status:', response.status);
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      }
    };
    
    fetchUserData();
  }, []);

  const handleSignOut = () => {
    // Only run in browser environment
    if (typeof window !== 'undefined') {
      // Clear all cookies by setting them to expire in the past
      const allCookies = document.cookie.split(';');
      console.log('Cookies before clearing:', allCookies);
      
      // Specifically clear the critical cookies with all path/domain combinations
      const cookiesToClear = ['orgId', 'userEmail', 'accessToken', 'refreshToken'];
      const domains = [window.location.hostname, '', null, 'stitchflow.com', `.${window.location.hostname}`];
      const paths = ['/', '/tools/shadow-it-scan', '/tools/shadow-it-scan/', '', null];
      
      // Try all combinations to ensure cookies are cleared
      for (const cookieName of cookiesToClear) {
        for (const domain of domains) {
          for (const path of paths) {
            const domainStr = domain ? `; domain=${domain}` : '';
            const pathStr = path ? `; path=${path}` : '';
            document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT${pathStr}${domainStr}`;
          }
        }
      }
      
      // Also try to clear all cookies generically
      allCookies.forEach((cookie: string) => {
        const [name] = cookie.trim().split('=');
        if (name) {
          // Try with different domain/path combinations
          for (const domain of domains) {
            for (const path of paths) {
              const domainStr = domain ? `; domain=${domain}` : '';
              const pathStr = path ? `; path=${path}` : '';
              document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT${pathStr}${domainStr}`;
            }
          }
        }
      });
      
      // Clear local storage
      localStorage.clear();
      
      // Clear session storage too
      sessionStorage.clear();
      
      console.log('Cookies after clearing:', document.cookie);
      
      // Redirect and force refresh (using a timestamp to prevent caching)
      window.location.href = `/tools/shadow-it-scan/`;
    }
  };

  
  // Sorting function
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortColumn(column)
      setSortDirection("asc")
    }
  }

  // Get sort icon for column header
  const getSortIcon = (column: SortColumn) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="ml-1 h-4 w-4 opacity-50" />
    }
    return sortDirection === "asc" ? <ArrowUp className="ml-1 h-4 w-4" /> : <ArrowDown className="ml-1 h-4 w-4" />
  }

  // Memoize filtered applications
  const filteredApps = useMemo(() => {
    return applications.filter((app) => {
      const matchesSearch = searchTerm === "" || 
      app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (app.category && app.category.toLowerCase().includes(searchTerm.toLowerCase()))
    const matchesRisk = filterRisk ? app.riskLevel === filterRisk : true
    const matchesManaged = filterManaged ? app.managementStatus === filterManaged : true
    // Use appCategories for filtering if available, otherwise fallback to app.category
    const effectiveCategory = appCategories[app.id] || app.category;
    const matchesCategory = filterCategory ? effectiveCategory === filterCategory : true

    return matchesSearch && matchesRisk && matchesManaged && matchesCategory
  })
  }, [applications, searchTerm, filterRisk, filterManaged, filterCategory, appCategories]) // Added appCategories to dependency array

  // Get unique categories for the filter dropdown
  const uniqueCategories = [...new Set(applications.map(app => appCategories[app.id] || app.category).filter((category): category is string => category !== null))].sort()

  // Sort applications
  const sortedApps = [...filteredApps].sort((a, b) => {
    // Helper for numeric comparison with direction
    const compareNumeric = (valA: number, valB: number) => {
      return sortDirection === "asc" ? valA - valB : valB - valA
    }

    // Helper for string comparison with direction
    const compareString = (a: string | null, b: string | null): number => {
      if (!a && !b) return 0
      if (!a) return -1
      if (!b) return 1
      return sortDirection === "asc" ? a.localeCompare(b) : b.localeCompare(a)
    }

    // Helper for date comparison with direction
    const compareDate = (valA: string, valB: string) => {
      const dateA = new Date(valA).getTime()
      const dateB = new Date(valB).getTime()
      return sortDirection === "asc" ? dateA - dateB : dateB - dateA
    }

    // Risk level comparison helper
    const getRiskValue = (risk: string) => {
      switch (risk.toLowerCase()) {
        case "high":
          return 3
        case "medium":
          return 2
        case "low":
          return 1
        default:
          return 0
      }
    }

    switch (sortColumn) {
      case "name":
        return compareString(a.name, b.name)
      case "category":
        return compareString(a.category, b.category)
      case "userCount":
        return compareNumeric(a.userCount, b.userCount)
      case "riskLevel":
        return compareNumeric(getRiskValue(a.riskLevel), getRiskValue(b.riskLevel))
      case "totalPermissions":
        return compareNumeric(a.totalPermissions, b.totalPermissions)
      case "managementStatus":
        return compareString(a.managementStatus, b.managementStatus)
      case "highRiskUserCount":
        // Use transformRiskLevel to normalize the riskLevel values during comparison
        const highRiskA = a.users.filter(u => transformRiskLevel(u.riskLevel) === "High").length;
        const highRiskB = b.users.filter(u => transformRiskLevel(u.riskLevel) === "High").length;
        return compareNumeric(highRiskA, highRiskB);
      default:
        // Default to sorting by risk level and then user count
        const riskDiff = compareNumeric(getRiskValue(a.riskLevel), getRiskValue(b.riskLevel))
        if (riskDiff !== 0) return riskDiff
        return compareNumeric(a.userCount, b.userCount)
    }
  })

  // Pagination logic
  const totalPages = Math.ceil(sortedApps.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentApps = sortedApps.slice(startIndex, endIndex)

  // Generate page numbers with ellipsis
  const getPageNumbers = () => {
    const pages = []
    const maxVisiblePages = 5 // Show at most 5 page numbers

    if (totalPages <= maxVisiblePages) {
      // Show all pages if total pages are less than or equal to maxVisiblePages
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      // Always show first page
      pages.push(1)

      if (currentPage <= 3) {
        // Near the start
        for (let i = 2; i <= 4; i++) {
          pages.push(i)
        }
        pages.push('...')
        pages.push(totalPages)
      } else if (currentPage >= totalPages - 2) {
        // Near the end
        pages.push('...')
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i)
        }
      } else {
        // Middle - show current page and neighbors
        pages.push('...')
        pages.push(currentPage - 1)
        pages.push(currentPage)
        pages.push(currentPage + 1)
        pages.push('...')
        pages.push(totalPages)
      }
    }

    return pages
  }

  const selectedApp = selectedAppId ? applications.find((app) => app.id === selectedAppId) : null

  // Memoize filtered users
  const filteredUsers = useMemo(() => {
    return selectedApp?.users.filter(
      (user) =>
        user.name.toLowerCase().includes(debouncedUserSearchTerm.toLowerCase()) ||
        user.email.toLowerCase().includes(debouncedUserSearchTerm.toLowerCase()),
    ) || []
  }, [selectedApp, debouncedUserSearchTerm])

  // Sort users
  const sortedUsers = useMemo(() => {
    return [...filteredUsers].sort((a, b) => {
      const compareString = (valA: string, valB: string) => {
        return userSortDirection === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA)
      }

      const compareDate = (valA: string | undefined, valB: string | undefined) => {
        // If either value is undefined, handle it
        if (!valA && !valB) return 0;
        if (!valA) return userSortDirection === "asc" ? -1 : 1;
        if (!valB) return userSortDirection === "asc" ? 1 : -1;
        
        const dateA = new Date(valA).getTime()
        const dateB = new Date(valB).getTime()
        return userSortDirection === "asc" ? dateA - dateB : dateB - dateA
      }

      switch (userSortColumn) {
        case "name":
          return compareString(a.name, b.name)
        case "email":
          return compareString(a.email, b.email)
        case "created":
          return compareDate(a.created_at, b.created_at)
        case "riskLevel": {
          // Create a more comprehensive mapping to handle all possible RiskLevel values
          const riskOrder: Record<string, number> = { 
            'Low': 1, 'low': 1, 'LOW': 1,
            'Medium': 2, 'medium': 2, 'MEDIUM': 2, 
            'High': 3, 'high': 3, 'HIGH': 3
          };
          
          // Use transformRiskLevel to normalize keys as needed
          return userSortDirection === "asc" 
            ? (riskOrder[transformRiskLevel(a.riskLevel)] || 0) - (riskOrder[transformRiskLevel(b.riskLevel)] || 0)
            : (riskOrder[transformRiskLevel(b.riskLevel)] || 0) - (riskOrder[transformRiskLevel(a.riskLevel)] || 0);
        }
        default:
          return 0
      }
    })
  }, [filteredUsers, userSortColumn, userSortDirection])

  // Pagination calculations
  const userStartIndex = (userCurrentPage - 1) * itemsPerPage
  const userEndIndex = userStartIndex + itemsPerPage
  const currentUsers = sortedUsers.slice(userStartIndex, userEndIndex)
  const totalUserPages = Math.ceil(sortedUsers.length / itemsPerPage)

  // Add after handleCloseUserModal
  const getUserPageNumbers = () => {
    const pages = []
    const maxVisiblePages = 5

    if (totalUserPages <= maxVisiblePages) {
      for (let i = 1; i <= totalUserPages; i++) {
        pages.push(i)
      }
    } else {
      pages.push(1)

      if (userCurrentPage <= 3) {
        for (let i = 2; i <= 4; i++) {
          pages.push(i)
        }
        pages.push('...')
        pages.push(totalUserPages)
      } else if (userCurrentPage >= totalUserPages - 2) {
        pages.push('...')
        for (let i = totalUserPages - 3; i <= totalUserPages; i++) {
          pages.push(i)
        }
      } else {
        pages.push('...')
        pages.push(userCurrentPage - 1)
        pages.push(userCurrentPage)
        pages.push(userCurrentPage + 1)
        pages.push('...')
        pages.push(totalUserPages)
      }
    }

    return pages
  }

  // Modify the checkAuth function to be more generic
  const isAuthenticated = () => {
    // Only access cookies in the browser
    if (typeof window === 'undefined') {
      return false; // On server, consider not authenticated
    }
    
    // Debug: Log all cookies to see what's available
    const allCookies = document.cookie;
    console.log("All cookies:", allCookies);
    
    const cookies = document.cookie.split(';');
    console.log("Split cookies:", cookies);
    
    // Trim the cookies and check for orgId and userEmail
    const orgIdCookie = cookies.find(cookie => cookie.trim().startsWith('orgId='));
    const userEmailCookie = cookies.find(cookie => cookie.trim().startsWith('userEmail='));
    
    console.log("orgIdCookie:", orgIdCookie);
    console.log("userEmailCookie:", userEmailCookie);
    
    // Use the same logic as in fetchData to also check URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const urlOrgId = urlParams.get('orgId');
    
    console.log("URL orgId:", urlOrgId);
    
    // Consider authenticated if either cookies or URL param is present
    const authenticated = !!(orgIdCookie && userEmailCookie) || !!urlOrgId;
    console.log("Authentication result:", authenticated);
    
    return authenticated;
  };

  console.log("isAuthenticated", isAuthenticated());

  const checkAuth = (action: () => void) => {
    if (!isAuthenticated()) {
      setShowLoginModal(true);
      return false;
    }
    
    action();
    return true;
  };

  // Modify click handlers for insights tab
  const handleViewInsights = () => {
    checkAuth(() => {
      setMainView("Insights");
      handleCloseUserModal();
    });
  };

  // Modify click handlers for settings
  const handleOpenSettings = () => {
    checkAuth(() => setIsSettingsOpen(true));
  };

  // Modify your click handlers to use checkAuth
  const handleSeeUsers = (appId: string) => {
    checkAuth(() => {
      setSelectedAppId(appId);
      setIsUserModalOpen(true);
    });
  };

  // Handle closing user details
  const handleCloseUserModal = () => {
    setIsUserModalOpen(false)
    setSelectedAppId(null)
    setUserSearchTerm("")
  }

  // Handle status change
  const handleStatusChange = async (appId: string, newStatus: string) => {
    try {
      const response = await fetch('/tools/shadow-it-scan/api/applications', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: appId,
          managementStatus: newStatus,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update status');
      }

      // Update local state immediately after successful API call
      setApplications((prevApps) =>
        prevApps.map((app) =>
          app.id === appId ? { ...app, managementStatus: newStatus as "Managed" | "Unmanaged" | "Needs Review" } : app,
        ),
      );

      // Update edited statuses state
      setEditedStatuses((prev) => ({
        ...prev,
        [appId]: newStatus,
      }));

      // Fetch updated data from the server
      const updatedResponse = await fetch(`/tools/shadow-it-scan/api/applications?orgId=${new URLSearchParams(window.location.search).get('orgId')}`);
      if (updatedResponse.ok) {
        const updatedData = await updatedResponse.json();
        setApplications(updatedData);
      }
    } catch (error) {
      console.error('Error updating status:', error);
      // Optionally, you could add error handling UI feedback here
    }
  };

  // Helper function to group users by identical scope sets
  function getScopeGroups(app: Application | null) {
    if (!app) return []

    // Create a map of scope sets to users
    const scopeGroups = new Map<string, { scopes: string[]; users: AppUser[]; isAllScopes?: boolean }>()

    // First, create a group for all scopes from the application
    const allScopes = [...app.scopes].sort()
    scopeGroups.set("ALL_SCOPES", {
      scopes: allScopes,
      users: [], // This may be empty if no user has all permissions
      isAllScopes: true // Mark this as the special "All Possible Scopes" group
    })

    // Then group users by their specific scope sets
    app.users.forEach((user) => {
      // Sort scopes to ensure consistent grouping
      const sortedScopes = [...user.scopes].sort()
      const scopeKey = sortedScopes.join("|")

      if (!scopeGroups.has(scopeKey)) {
        scopeGroups.set(scopeKey, {
          scopes: sortedScopes,
          users: [],
        })
      }

      scopeGroups.get(scopeKey)?.users.push(user)
    })

    // Convert map to array for rendering
    // Sort by number of scopes (descending) so the full scope set appears first
    return Array.from(scopeGroups.values())
      .sort((a, b) => {
        // Always put the "All Scopes" group first
        if (a.isAllScopes) return -1;
        if (b.isAllScopes) return 1;
        // Then sort remaining groups by number of scopes
        return b.scopes.length - a.scopes.length;
      })
  }

  // Chart data preparation functions
  const getCategoryChartData = (): CategoryData[] => {
    const categoryMap = new Map<string, number>()

    applications.forEach((app) => {
      // Use the latest category from appCategories if available, or fall back to app.category
      const currentCategory = appCategories[app.id] || app.category || "Uncategorized"
      categoryMap.set(currentCategory, (categoryMap.get(currentCategory) || 0) + 1)
    })

    return Array.from(categoryMap.entries()).map(([name, value]) => ({
      name,
      value,
      color: getCategoryColor(name)
    }))
  }

  const getAppsUsersBarData = (): BarChartData[] => {
    const categoryMap = new Map<string, { apps: number; users: number }>()

    applications.forEach((app) => {
      // Use the latest category from appCategories if available, or fall back to app.category
      const currentCategory = appCategories[app.id] || app.category || "Uncategorized"
      if (!categoryMap.has(currentCategory)) {
        categoryMap.set(currentCategory, { apps: 0, users: 0 })
      }

      const data = categoryMap.get(currentCategory)!
      data.apps += 1
      data.users += app.userCount
    })

    return Array.from(categoryMap.entries()).map(([name, data]) => ({
      name,
      ...data,
    }))
  }

  // Update the getTop10AppsByUsers function to not truncate names
  const getTop10AppsByUsers = () => {
    const sorted = [...applications].sort((a, b) => b.userCount - a.userCount)
    return sorted.slice(0, 10).map((app) => ({
      name: app.name,
      value: app.userCount, // Keep value for chart compatibility
      color: getCategoryColor(appCategories[app.id] || app.category), // Use latest category color
    }))
  }

  // Get top 10 apps by permissions
  const getTop10AppsByPermissions = () => {
    // Filter by managed status if selected
    let filtered = applications;
    if (scopePermissionsManagedStatusFilter && scopePermissionsManagedStatusFilter !== 'Any Status') {
      filtered = applications.filter(app => app.managementStatus === scopePermissionsManagedStatusFilter);
    }
    
    // Sort by number of permissions (scope count)
    const sorted = [...filtered].sort((a, b) => b.totalPermissions - a.totalPermissions);
    
    return sorted.map((app) => ({
      name: app.name,
      value: app.totalPermissions,
      color: getCategoryColor(appCategories[app.id] || app.category),
    }));
  };

  const getTop5Apps = () => {
    return [...applications]
      .sort((a, b) => b.userCount - a.userCount)
      .slice(0, 5)
      .map((app) => ({
        name: app.name,
        users: app.userCount,
      }))
  }

  const getRiskChartData = (): RiskData[] => {
    const riskMap = new Map<string, number>()

    applications.forEach((app) => {
      riskMap.set(app.riskLevel, (riskMap.get(app.riskLevel) || 0) + 1)
    })

    const riskColors: Record<string, string> = {
      Low: "#81C784",    // darker pastel green
      Medium: "#FFD54F", // darker pastel yellow
      High: "#EF5350",   // darker pastel red
    }

    return Array.from(riskMap.entries()).map(([name, value]) => ({
      name,
      value,
      color: riskColors[name],
    }))
  }

  // Get category distribution data for the pie chart
  const getCategoryDistributionData = () => {
    const categoryCount = new Map<string, number>()

    applications.forEach((app) => {
      // Use the latest category from appCategories if available, or fall back to app.category
      const currentCategory = appCategories[app.id] || app.category || "Uncategorized"
      categoryCount.set(currentCategory, (categoryCount.get(currentCategory) || 0) + 1)
    })

    const totalApps = applications.length

    return Array.from(categoryCount.entries()).map(([category, count]) => ({
      name: category,
      value: count,
      percentage: totalApps > 0 ? Math.round((count / totalApps) * 100) : 0,
      color: getCategoryColor(category)
    }))
  }

  // Update the getCategoryColor function for charts
  const getCategoryColor = (category: string | null): string => {
    if (!category) return "#CBD5E1"; // Default gray for null/undefined
    
    // Fixed color mapping for consistent colors with proper hex values instead of tailwind classes
    const colorMap: Record<string, string> = {
      "Analytics & Business Intelligence":   "#FBCFE8", // pink-200  :contentReference[oaicite:0]{index=0}
      "Cloud Platforms & Infrastructure":    "#C7D2FE", // indigo-200  :contentReference[oaicite:1]{index=1}
      "Customer Success & Support":          "#99F6E4", // teal-200  :contentReference[oaicite:2]{index=2}
      "Design & Creative Tools":             "#F5D0FE", // fuchsia-200  :contentReference[oaicite:3]{index=3}
      "Developer & Engineering Tools":       "#BFDBFE", // blue-200  :contentReference[oaicite:4]{index=4}
      "Finance & Accounting":                "#FDE68A", // amber-200  :contentReference[oaicite:5]{index=5}
      "Human Resources & People Management": "#D9F99D", // lime-200  :contentReference[oaicite:6]{index=6}
      "IT Operations & Security":            "#FECACA", // red-200   :contentReference[oaicite:7]{index=7}
      "Identity & Access Management":        "#DDD6FE", // violet-200  :contentReference[oaicite:8]{index=8}
      "Productivity & Collaboration":        "#A7F3D0", // emerald-200  :contentReference[oaicite:9]{index=9}
      "Project Management":                  "#FED7AA", // orange-200  :contentReference[oaicite:10]{index=10}
      "Sales & Marketing":                   "#A5F3FC", // cyan-200   :contentReference[oaicite:11]{index=11}
      Others:                                "#E5E7EB", // gray-200   :contentReference[oaicite:12]{index=12}
    };
    // Return the mapped color or a default
    return colorMap[category] || "#E2E8F0"; // Default slate-200 for unknown categories
  };

  // Generate monthly active users data
  const getMonthlyActiveUsers = () => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    // Generate realistic data with higher values in summer months
    return months.map((month) => {
      let value
      if (["Jul", "Aug", "Sep", "Oct"].includes(month)) {
        // Summer/Fall months - higher engagement
        value = Math.floor(Math.random() * 25) + 65 // 65-90%
      } else if (["May", "Jun", "Nov", "Dec"].includes(month)) {
        // Late spring/early summer and winter - medium engagement
        value = Math.floor(Math.random() * 20) + 45 // 45-65%
      } else {
        // Winter/early spring - lower engagement
        value = Math.floor(Math.random() * 15) + 30 // 30-45%
      }

      return {
        name: month,
        value,
      }
    })
  }

  // App Icon component with improved fallbacks
  const AppIcon = ({ name, logoUrl, logoUrlFallback }: { 
    name: string; 
    logoUrl?: string;
    logoUrlFallback?: string;
  }) => {
    // Get the first letter of the app name
    const initial = name.charAt(0).toUpperCase();
    const [primaryLogoError, setPrimaryLogoError] = useState(false);
    const [fallbackLogoError, setFallbackLogoError] = useState(false);

    // Generate a consistent background color based on app name
    const getBackgroundColor = (appName: string) => {
      // Simple hash function to generate a consistent color
      const hash = appName.split('').reduce((acc, char) => {
        return char.charCodeAt(0) + ((acc << 5) - acc);
      }, 0);
      
      // Generate a pastel color using the hash
      const h = Math.abs(hash) % 360;
      return `hsl(${h}, 70%, 85%)`;
    };

    const bgColor = getBackgroundColor(name);

    // Use primary logo, fallback logo, or initial with colored background
    if (logoUrl && !primaryLogoError) {
      return (
        <div className="w-8 h-8 rounded-md overflow-hidden">
          <Image
            src={logoUrl}
            alt={`${name} logo`}
            width={32}
            height={32}
            className="object-contain"
            onError={() => setPrimaryLogoError(true)}
          />
        </div>
      );
    } else if (logoUrlFallback && !fallbackLogoError) {
      return (
        <div className="w-8 h-8 rounded-md overflow-hidden">
          <Image
            src={logoUrlFallback}
            alt={`${name} logo (fallback)`}
            width={32}
            height={32}
            className="object-contain"
            onError={() => setFallbackLogoError(true)}
          />
        </div>
      );
    } else {
      return (
        <div 
          className="flex items-center justify-center w-8 h-8 rounded-md text-gray-800 font-medium"
          style={{ backgroundColor: bgColor }}
        >
          {initial}
        </div>
      );
    }
  };

  // Update the getCategoryColor function in the CategoryBadge component
  const CategoryBadge = ({ category, appId, isCategorizing }: { category: string | null; appId: string; isCategorizing?: boolean }) => {
    // Use the latest category from appCategories if available, otherwise use the prop
    const currentCategory = appCategories[appId] || category;
    const isCurrentlyCategorizing = isCategorizing || (uncategorizedApps.has(appId) && (!currentCategory || currentCategory === 'Unknown'));

    if (isCurrentlyCategorizing) {
      return (
        <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          <div className="mr-1 h-2 w-2 rounded-full bg-blue-400 animate-pulse"></div>
          Categorizing...
        </div>
      );
    }

    if (!currentCategory) {
      return (
        <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          Uncategorized
        </div>
      );
    }

    const getCategoryBadgeColor = (category: string) => {
      // Use the same color mapping but for tailwind classes
      const colorMap: Record<string, string> = 
      {
        "Analytics & Business Intelligence":   "bg-pink-100     text-pink-600",
        "Cloud Platforms & Infrastructure":    "bg-indigo-100   text-indigo-600",
        "Customer Success & Support":          "bg-teal-100     text-teal-600",
        "Design & Creative Tools":             "bg-fuchsia-100  text-fuchsia-600",
        "Developer & Engineering Tools":       "bg-blue-100     text-blue-600",
        "Finance & Accounting":                "bg-amber-100    text-amber-600",
        "Human Resources & People Management": "bg-lime-100     text-lime-600",
        "IT Operations & Security":            "bg-red-100      text-red-600",
        "Identity & Access Management":        "bg-violet-100   text-violet-600",
        "Productivity & Collaboration":        "bg-emerald-100  text-emerald-600",
        "Project Management":                  "bg-orange-100   text-orange-600",
        "Sales & Marketing":                   "bg-cyan-100     text-cyan-600",
        Others:                                "bg-gray-100     text-gray-600",
      };
      return colorMap[category] || "bg-slate-100 text-slate-800";
    };

    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getCategoryBadgeColor(currentCategory)} overflow-hidden text-ellipsis whitespace-nowrap max-w-[200px] group-hover:max-w-none`}
            >
              {currentCategory}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="p-2 bg-gray-900 text-white rounded-md shadow-lg">
            <p className="text-xs">{currentCategory}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Update RiskBadge component to determine correct risk level from the user's scopes
  function RiskBadge({ level, scopes }: { level: string, scopes?: string[] }) {
    let riskLevel: RiskLevel;

    if (scopes && Array.isArray(scopes) && scopes.length > 0) {
      // Use the centralized risk assessment logic
      riskLevel = determineRiskLevel(scopes);
    } else {
      // For backward compatibility, transform the provided level
      riskLevel = transformRiskLevel(level);
    }
    
    // Normalize for display (e.g., "High", "Medium", "Low")
    const normalizedLevel = transformRiskLevel(riskLevel);
    
    const iconMap: Record<string, JSX.Element> = {
      Low: <CheckCircle className="h-5 w-5 mr-1 text-green-700" />,
      Medium: <AlertTriangle className="h-5 w-5 mr-1 text-yellow-700" />,
      High: <AlertTriangle className="h-5 w-5 mr-1 text-pink-700" />
    }

    const colorMap: Record<string, string> = {
      Low: "text-green-700 bg-green-50",
      Medium: "text-yellow-700 bg-yellow-50",
      High: "text-pink-700 bg-pink-50"
    }

    return (
      <div className={`flex items-center px-2 py-1 rounded-full ${colorMap[normalizedLevel] || colorMap.Low}`}>
        {iconMap[normalizedLevel] || iconMap.Low}
        <span>{normalizedLevel}</span>
      </div>
    )
  }

  // Date formatting function
  function formatDate(dateString: string | null | undefined): string {
    if (!dateString) {
      return 'N/A';
    }

    try {
      const date = new Date(dateString);
      
      // Check if the date is valid
      if (isNaN(date.getTime())) {
        return 'Invalid date';
      }

      // Format like "Mar 2, 2025, 1:29 AM"
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(date);
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Error';
    }
  }

  // Handle user table sorting
  const handleUserSort = (column: "name" | "email" | "created" | "riskLevel") => {
    if (userSortColumn === column) {
      setUserSortDirection(userSortDirection === "asc" ? "desc" : "asc")
    } else {
      setUserSortColumn(column)
      setUserSortDirection("asc")
    }
  }

  // Get sort icon for user table column header
  const getUserSortIcon = (column: "name" | "email" | "created" | "riskLevel") => {
    if (userSortColumn !== column) {
      return <ArrowUpDown className="ml-1 h-4 w-4 opacity-50" />
    }
    return userSortDirection === "asc" ? <ArrowUp className="ml-1 h-4 w-4" /> : <ArrowDown className="ml-1 h-4 w-4" />
  }

  // Add after getUserPageNumbers
  const getScopePageNumbers = (totalPages: number) => {
    const pages = []
    const maxVisiblePages = 5

    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      pages.push(1)

      if (scopeCurrentPage <= 3) {
        for (let i = 2; i <= 4; i++) {
          pages.push(i)
        }
        pages.push('...')
        pages.push(totalPages)
      } else if (scopeCurrentPage >= totalPages - 2) {
        pages.push('...')
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i)
        }
      } else {
        pages.push('...')
        pages.push(scopeCurrentPage - 1)
        pages.push(scopeCurrentPage)
        pages.push(scopeCurrentPage + 1)
        pages.push('...')
        pages.push(totalPages)
      }
    }

    return pages
  }

  // Add before the return statement
  function getAppFunctionality(scopes: string[]): Set<string> {
    const functions = new Set<string>();
    scopes.forEach(scope => {
      if (scope.includes('drive') || scope.includes('docs')) {
        functions.add('document_collaboration');
      }
      if (scope.includes('calendar')) {
        functions.add('scheduling');
      }
      if (scope.includes('mail') || scope.includes('gmail')) {
        functions.add('communication');
      }
      if (scope.includes('sheets')) {
        functions.add('data_analysis');
      }
      if (scope.includes('slides')) {
        functions.add('presentation');
      }
      if (scope.includes('admin')) {
        functions.add('administration');
      }
      if (scope.includes('chat') || scope.includes('meet')) {
        functions.add('team_collaboration');
      }
    });
    return functions;
  }

  // Add after the getAppFunctionality function
  function getSimilarApps(currentApp: Application, allApps: Application[]): Array<{app: Application, score: number, reasons: string[]}> {
    return allApps
      .filter(app => app.id !== currentApp.id)
      .map(app => {
        // Create a temporary app object with updated category for similarity calculation
        const appWithCurrentCategory = {
          ...app,
          category: appCategories[app.id] || app.category
        };
        const currentAppWithUpdatedCategory = {
          ...currentApp,
          category: appCategories[currentApp.id] || currentApp.category
        };
        
        const score = calculateSimilarityScore(currentAppWithUpdatedCategory, appWithCurrentCategory);
        const reasons = getSimilarityReasons(currentAppWithUpdatedCategory, appWithCurrentCategory);
        return { app, score, reasons };
      })
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  function calculateSimilarityScore(app1: Application, app2: Application): number {
    let score = 0;
    
    // User co-occurrence (50%)
    const sharedUsers = app1.users.filter(u1 => 
      app2.users.some(u2 => u2.email === u1.email)
    ).length;
    const userOverlapScore = Math.min(sharedUsers / Math.max(app1.users.length, app2.users.length, 1), 1) * 0.5;
    
    // Functional similarity (30%)
    const app1Functions = getAppFunctionality(app1.scopes);
    const app2Functions = getAppFunctionality(app2.scopes);
    const sharedFunctions = Array.from(app1Functions).filter(f => app2Functions.has(f)).length;
    const functionalScore = Math.min(sharedFunctions / Math.max(app1Functions.size, app2Functions.size, 1), 1) * 0.3;
    
    // Usage patterns (20%)
    // Only calculate if both apps have lastActive data
    let usageScore = 0.2; // Default score if we can't calculate
    
    score = userOverlapScore + functionalScore + usageScore;
    return score;
  }

  function getSimilarityReasons(app1: Application, app2: Application): string[] {
    const reasons: string[] = [];
    
    // Check user overlap
    const sharedUsers = app1.users.filter(u1 => 
      app2.users.some(u2 => u2.email === u1.email)
    ).length;
    if (sharedUsers > 0) {
      reasons.push(`${sharedUsers} shared users`);
    }
    
    // Check functional similarity
    const app1Functions = getAppFunctionality(app1.scopes);
    const app2Functions = getAppFunctionality(app2.scopes);
    const sharedFunctions = Array.from(app1Functions).filter(f => app2Functions.has(f));
    if (sharedFunctions.length > 0) {
      reasons.push(`Similar functionality: ${sharedFunctions.join(', ')}`);
    }
    
    // Check if they belong to the same category
    const category1 = app1.category;
    const category2 = app2.category;
    if (category1 && category2 && category1 === category2 && category1 !== 'Unknown') {
      reasons.push(`Same category: ${category1}`);
    }
    
    return reasons;
  }

  // Add after the getMonthlyActiveUsers function
  function getAppSimilarityNetwork() {
    // Create nodes for each app
    const nodes = applications.map(app => ({
      id: app.id,
      name: app.name,
      category: app.category,
      value: app.userCount, // Size based on user count
      color: getCategoryColor(app.category)
    }));

    // Create edges between similar apps
    const edges: Array<{source: string, target: string, value: number}> = [];
    
    applications.forEach(app1 => {
      const similarApps = getSimilarApps(app1, applications);
      similarApps.forEach(({ app: app2, score }) => {
        if (score > 0.3) { // Only show strong connections
          edges.push({
            source: app1.id,
            target: app2.id,
            value: score
          });
        }
      });
    });

    return { nodes, edges };
  }

  // Add click outside handler for profile dropdown
  useEffect(() => {
    // Only add event listeners in browser environment
    if (typeof window !== 'undefined') {
      function handleClickOutside(event: MouseEvent) {
        if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
          setIsProfileOpen(false);
        }
      }

      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, []);

  // Helper function to generate a random ID
  const generateId = () => Math.random().toString(36).substr(2, 9);

  // Helper function to transform user data
  const transformUser = (name: string, appId: string, scopes: string[]): AppUser => ({
    id: generateId(),
    appId,
    name,
    email: `${name.toLowerCase().replace(' ', '.')}@example.com`,
    scopes,
    riskLevel: determineRiskLevel(scopes),
    riskReason: "Based on scope permissions and usage patterns",
  });


    // Helper to convert app name to likely domain format
  function appNameToDomain(appName: string): string {
    // Common apps with special domain formats
    const knownDomains: Record<string, string> = {
      'slack': 'slack.com',
      'stitchflow': 'stitchflow.io',
      'yeshid': 'yeshid.com',
      'onelogin': 'onelogin.com',
      'google drive': 'drive.google.com',
      'google chrome': 'google.com',
      'accessowl': 'accessowl.com',
      'accessowl scanner': 'accessowl.com',
      'mode analytics': 'mode.com',
      'hubspot': 'hubspot.com',
      'github': 'github.com',
      'gmail': 'gmail.com',
      'zoom': 'zoom.us',
      'notion': 'notion.so',
      'figma': 'figma.com',
      'jira': 'atlassian.com',
      'confluence': 'atlassian.com',
      'asana': 'asana.com',
      'trello': 'trello.com',
      'dropbox': 'dropbox.com',
      'box': 'box.com',
      'microsoft': 'microsoft.com',
      'office365': 'office.com'
    };
    
    // Convert app name to lowercase for case-insensitive lookup
    const lowerAppName = appName.toLowerCase();
    
    // Check for exact matches in known domains
    if (knownDomains[lowerAppName]) {
      return knownDomains[lowerAppName];
    }
    
    // Check for partial matches (e.g., if app name contains known key)
    for (const [key, domain] of Object.entries(knownDomains)) {
      if (lowerAppName.includes(key)) {
        return domain;
      }
    }
    
    // Default processing for unknown apps
    // Remove special characters, spaces, and convert to lowercase
    const sanitized = lowerAppName
      .replace(/[^\w\s-]/gi, '')  // Keep hyphens as they're common in domains
      .replace(/\s+/g, '');
    
    // Default to .com instead of .io
    return sanitized + '.com';
  }

  function getAppLogoUrl(appName: string) {
    const domain = appNameToDomain(appName);
    
    // Try to get the app icon using Logo.dev
    const logoUrl = `https://img.logo.dev/${domain}?token=pk_ZLJInZ4_TB-ZDbNe2FnQ_Q&format=png&retina=true`;
    
    // We could also provide a fallback URL using other icon services if needed
    // This gives us multiple ways to find a logo if the primary method fails
    const fallbackUrl = `https://icon.horse/icon/${domain}`;
    
    // Return both URLs so the frontend can try multiple sources
    return {
      primary: logoUrl,
      fallback: fallbackUrl
    };
  }

  // Function to transform the dummy data into our app's format
  const transformDummyData = (dummyData: any[]): Application[] => {
    return dummyData.map(item => {
      
      const id = generateId();
      const logoUrls = getAppLogoUrl(item.Apps);
      let appUsers = item.Users.map((user: string) => transformUser(user, id, item.Scopes));

      // Ensure some prominent dummy apps have high-risk users for UI demonstration
      if (item.Apps === "Slack" && appUsers.length > 0) {
        if (appUsers[0]) appUsers[0].riskLevel = "High";
        if (appUsers[1]) appUsers[1].riskLevel = "High"; // Ensure at least two for Slack if possible
      }
      if (item.Apps === "HubSpot" && appUsers.length > 0) {
        if (appUsers[0]) appUsers[0].riskLevel = "High";
      }
      if (item.Apps === "Looker Studio" && appUsers.length > 0) { // Another app that has "High" app risk
        if (appUsers[0]) appUsers[0].riskLevel = "High";
      }

      return {
        id,
        name: item.Apps,
        category: item.Category,
        userCount: appUsers.length,
        users: appUsers, // use the potentially modified appUsers
        riskLevel: item.Risk as RiskLevel,
        riskReason: "Based on scope permissions and usage patterns",
        totalPermissions: item["Total Scopes"],
        scopeVariance: { userGroups: Math.floor(Math.random() * 5) + 1, scopeGroups: Math.floor(Math.random() * 3) + 1 },
        managementStatus: item.Status as "Managed" | "Unmanaged" | "Needs Review",
        ownerEmail: "",
        logoUrl: logoUrls.primary,
        logoUrlFallback: logoUrls.fallback, // Assign fallback logo URL
        notes: "",
        scopes: item.Scopes,
        isInstalled: true,
        isAuthAnonymously: false
      };
    });
  };

  // Update the LoginModal component to fix both the top gap and maintain button spacing
  const LoginModal = ({ error }: { error: string }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [loginProvider, setLoginProvider] = useState<'google' | 'microsoft' | null>(null);
    const [currentLoginError, setCurrentLoginError] = useState(error); // Use prop for initial error
    const searchParams = useSearchParams();

    // Log data for debugging
    console.log("Login Modal Rendered, error state:", currentLoginError);
    console.log("URL Search Params:", Object.fromEntries(searchParams.entries()));

    useEffect(() => {
      setCurrentLoginError(error); // Update error when prop changes
    }, [error]);
    
    const handleGoogleLogin = async () => {
      try {
        setIsLoading(true);
        setLoginProvider('google');
        setCurrentLoginError(''); // Clear previous errors specifically for a new login attempt

        const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
        let redirectUri;

        if (!clientId) {
          setCurrentLoginError("Missing Google OAuth configuration");
          console.error('Missing client ID');
          setIsLoading(false);
          return;
        }

        // If we're on localhost, use the current origin
        if (window.location.hostname === 'localhost' || window.location.hostname.includes('127.0.0.1')) {
          redirectUri = `${window.location.origin}/tools/shadow-it-scan/api/auth/google/callback`;
        } else {
          redirectUri = 'https://stitchflow.com/tools/shadow-it-scan/api/auth/google';
        }
        
        console.log('Using redirectUri:', redirectUri);
        
        // Use minimal scopes initially - just enough to identify the user
        const scopes = [
          'openid',
          'profile',
          'email'
        ].join(' ');

        // Generate a state parameter to verify the response and enable cross-browser detection
        const state = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        
        // Always store in localStorage to identify this browser session
        localStorage.setItem('oauthState', state);
        localStorage.setItem('auth_provider', 'google');
        localStorage.setItem('lastLogin', Date.now().toString());
        localStorage.setItem('login_attempt_time', Date.now().toString());
        
        // Direct account selection - show the accounts dialog directly
        // This bypasses the initial email input screen
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authUrl.searchParams.append('client_id', clientId);
        authUrl.searchParams.append('redirect_uri', redirectUri);
        authUrl.searchParams.append('response_type', 'code');
        authUrl.searchParams.append('scope', scopes);
        authUrl.searchParams.append('access_type', 'offline'); 
        authUrl.searchParams.append('include_granted_scopes', 'true');
        authUrl.searchParams.append('state', state);
        
        // Clean URL before redirecting
        const cleanUrl = new URL(window.location.href);
        if (cleanUrl.searchParams.has('error')) {
          cleanUrl.searchParams.delete('error');
          window.history.replaceState({}, document.title, cleanUrl.toString());
        }

        window.location.href = authUrl.toString();
      } catch (err) {
        console.error('Login error:', err);
        setCurrentLoginError('Failed to initialize login. Please try again.');
        setIsLoading(false);
        setLoginProvider(null);
      }
    };

    const handleMicrosoftLogin = async () => {
      try {
        setIsLoading(true);
        setLoginProvider('microsoft');
        setCurrentLoginError(''); // Clear previous errors specifically for a new login attempt

        const clientId = process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID;
        let redirectUri = process.env.NEXT_PUBLIC_MICROSOFT_REDIRECT_URI;

        if (!clientId || !redirectUri) {
          setCurrentLoginError("Missing Microsoft OAuth configuration");
          console.error('Missing env variables:', { 
            clientId: clientId ? 'present' : 'missing',
            redirectUri: redirectUri ? 'present' : 'missing'
          });
          setIsLoading(false);
          setLoginProvider(null);
          return;
        }

        // If we're on localhost, update the redirect URI
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
          redirectUri = window.location.origin + '/api/auth/microsoft';
        } else {
          redirectUri = 'https://www.stitchflow.com/tools/shadow-it-scan/api/auth/microsoft';
        }
        
        console.log('Using redirectUri:', redirectUri);
        
        const scopes = [
          // Start with minimal scopes; we'll request admin scopes later if needed
          'User.Read',
          'offline_access',
          'openid',
          'profile',
          'email'
        ].join(' ');

        // Generate a state parameter to verify the response and enable cross-browser detection
        const state = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
        
        // Always store in localStorage to identify this browser session
        localStorage.setItem('oauthState', state);
        localStorage.setItem('auth_provider', 'microsoft');
        localStorage.setItem('lastLogin', Date.now().toString());
        localStorage.setItem('login_attempt_time', Date.now().toString());
        
        const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
        authUrl.searchParams.append('client_id', clientId);
        authUrl.searchParams.append('redirect_uri', redirectUri);
        authUrl.searchParams.append('response_type', 'code');
        authUrl.searchParams.append('scope', scopes);
        authUrl.searchParams.append('response_mode', 'query');
        authUrl.searchParams.append('prompt', 'select_account');
        authUrl.searchParams.append('state', state);

        // Clean URL before redirecting
        const cleanUrl = new URL(window.location.href);
        if (cleanUrl.searchParams.has('error')) {
          cleanUrl.searchParams.delete('error');
          window.history.replaceState({}, document.title, cleanUrl.toString());
        }

        window.location.href = authUrl.toString();
      } catch (err) {
        console.error('Microsoft login error:', err);
        setCurrentLoginError('Failed to initialize Microsoft login. Please try again.');
        setIsLoading(false);
        setLoginProvider(null);
      }
    };

    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-lg w-full max-w-md">
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-2">Sign in to continue</h2>
            <p className="text-sm text-gray-500 mb-6">
              Ensure you connect your admin org account to get started with the app
            </p>
            
            {/* Added stronger conditional check and inline style for better visibility */}
            {currentLoginError && currentLoginError.length > 0 && (
              <div className="mb-4 p-4 text-sm text-red-800 bg-red-100 rounded-lg border border-red-300">
                {currentLoginError}
              </div>
            )}
            
            <div className="flex flex-col space-y-4">
              <Button 
                onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
                size="lg"
                disabled={isLoading}
              >
                <img src="/tools/shadow-it-scan/images/google-logo.svg" alt="Google logo" className="h-5 w-5" />
                {isLoading && loginProvider === 'google' ? 'Connecting...' : 'Sign in with Google Workspace'}
              </Button>
              
              <Button 
                onClick={handleMicrosoftLogin}
                className="w-full flex items-center justify-center gap-2 bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
                size="lg"
                disabled={isLoading}
              >
                <img src="/tools/shadow-it-scan/images/microsoft-logo.svg" alt="Microsoft logo" className="h-5 w-5" />
                {isLoading && loginProvider === 'microsoft' ? 'Connecting...' : 'Sign in with Microsoft Entra ID'}
              </Button>
              
              <div className="flex justify-end mt-6">
                <Button variant="outline" onClick={() => setShowLoginModal(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Add a useEffect to force re-rendering the charts when in Insights view after new categories arrive
  useEffect(() => {
    // This effect will trigger whenever appCategories or mainView changes
    // No action needed - just having this dependency will cause charts to re-render
  }, [appCategories, mainView]);

  // We're now using the centralized risk assessment functions from '@/lib/risk-assessment'
  // instead of having duplicate risk assessment logic here

  // Apps by User Count - show all apps and filter by managed status
  const getAppsByUserCountChartData = () => {
    let filtered = applications;
    if (chartManagedStatusFilter && chartManagedStatusFilter !== 'Any Status') {
      filtered = applications.filter(app => app.managementStatus === chartManagedStatusFilter);
    }
    const sorted = [...filtered].sort((a, b) => b.userCount - a.userCount);
    return sorted.map((app) => ({
      name: app.name,
      value: app.userCount,
      color: getCategoryColor(appCategories[app.id] || app.category), // Ensure this provides a valid color string
    }));
  };

  // High Risk Users by App - chart data preparation
  const getHighRiskUsersByApp = () => {
    // Filter by managed status if selected
    let filtered = applications;
    if (highRiskUsersManagedStatusFilter && highRiskUsersManagedStatusFilter !== 'Any Status') {
      filtered = applications.filter(app => app.managementStatus === highRiskUsersManagedStatusFilter);
    }
    
    // Map applications to get name, high-risk user count, and color
    const mappedData = filtered.map(app => ({
      name: app.name,
      value: app.users.filter(user => transformRiskLevel(user.riskLevel) === "High").length,
      color: getCategoryColor(appCategories[app.id] || app.category),
    }));
    
    // Sort by number of high-risk users (descending)
    return mappedData.sort((a, b) => b.value - a.value);
  };

  // Update the states when an app is selected
  useEffect(() => {
    if (selectedApp) {
      setOwnerEmail(selectedApp.ownerEmail || "");
      setNotes(selectedApp.notes || "");
    }
  }, [selectedApp]);

  // Function to save owner email and notes
  const handleSaveNotesAndOwner = async () => {
    if (!selectedApp) return;

    try {
      setIsSaving(true);
      setSaveMessage(null);

      const response = await fetch('/tools/shadow-it-scan/api/applications', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: selectedApp.id,
          ownerEmail,
          notes,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update application');
      }

      // Update applications state with the updated app
      setApplications(prevApps => {
        // Create a new array with the updated application
        const updatedApps = prevApps.map(app => 
          app.id === selectedApp.id 
            ? { ...app, ownerEmail, notes } 
            : app
        );
        
        return updatedApps;
      });

      // No need to update selectedAppId as it would trigger a re-render and potentially close the modal

      setSaveMessage({
        type: "success",
        text: "Successfully saved changes"
      });

      // Hide the success message after 3 seconds
      setTimeout(() => {
        setSaveMessage(null);
      }, 3000);
    } catch (error) {
      console.error('Error saving notes and owner:', error);
      setSaveMessage({
        type: "error",
        text: "Failed to save changes. Please try again."
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto font-sans text-gray-900 bg-[#FAF8FA]">

      <header className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="flex items-center align-middle justify-between max-w-7xl mx-auto px-4 sm:px-8 py-3">
          <div className="flex items-center gap-2.5">
            <a href="https://www.stitchflow.com" target="_blank" rel="noopener noreferrer" className="flex items-center">
              <img
                src="/Stitchflow.png"
                alt="Stitchflow"
                className="h-6 w-auto"
              />
            </a>
            <span className="text-lg font-medium font-['Epilogue', sans-serif] text-gray-900 flex items-center">Shadow IT Scanner</span>
          </div>
        </div>
      </header>

       
          <div className="text-center space-y-4 sm:space-y-6 py-6 sm:py-16 px-4 max-w-[1900px] mx-auto">
            <a
              href="https://www.stitchflow.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-full text-xs font-medium hover:bg-primary/15 transition-colors"
            >
              A tool from Stitchflow
              <ExternalLink className="h-3 w-3" />
            </a>
            
            <div className="space-y-4 sm:space-y-6">
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mx-auto max-w-[900px] leading-tight">
              Shadow IT Scanner 
              </h1>
              
              <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Discover the apps your employees are using, detect potential risks by tracking app scopes, and prevent compliance gaps before they escalate.
              </p>
            </div>
          </div>


        

      <main className="pt-[40px] pl-10 pr-10 bg-white mt-4 pb-10">

            {!isAuthenticated() && (
              <div className="bg-black border border-gray-800 rounded-lg p-4 mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-yellow-500">👋</span>
                    <p className="text-gray-200">
                    This is a preview of the app. Get started with the Shadow IT scan for your workspace
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      setShowLoginModal(true)
                    }}
                    variant="outline"
                    className="w-full sm:w-auto bg-white hover:bg-white/90 text-black border-white hover:text-black transition-colors"
                  >
                    Sign in
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-xl font-bold">Shadow IT Overview</h2>
              <Share url="https://www.stitchflow.com/tools/shadow-it-scan" />
            </div>

            {isLoading ? (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
                <div className="p-6 flex justify-center items-center min-h-[400px]">
                  <div className="flex flex-col items-center gap-4">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
                    <p>Loading application data...</p>
                  </div>
                </div>
              </div>
            ) : !selectedAppId ? (
              <div ref={mainContentRef} className="space-y-6"> {/* Added ref here */}
                <div className="flex justify-between items-center mt-[-4px]">
                  <div>
                    <p className="text-lg font-medium text-gray-800">
                      {(() => {
                        // Count how many filters are active
                        const activeFilters = [filterCategory, filterRisk, filterManaged].filter(Boolean).length;
                        
                        if (activeFilters === 0) {
                          return `We found ${sortedApps.length} applications.`;
                        }

                        // Single filter messages
                        if (activeFilters === 1) {
                          if (filterCategory) {
                            return `We found ${sortedApps.length} applications in ${filterCategory}.`;
                          }
                          if (filterRisk) {
                            return `We found ${sortedApps.length} ${filterRisk.toLowerCase()} risk applications.`;
                          }
                          if (filterManaged) {
                            return `We found ${sortedApps.length} ${filterManaged.toLowerCase()} applications.`;
                          }
                        }

                        // Multiple filters - show total count with "filtered"
                        return `We found ${sortedApps.length} filtered applications.`;
                      })()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      variant={mainView === "list" ? "default" : "outline"} 
                      onClick={() => {
                        setMainView("list");
                        handleCloseUserModal();
                      }}
                      className={mainView === "list" ? "bg-gray-900 hover:bg-gray-800" : ""}
                    >
                      <LayoutGrid className="h-4 w-4 mr-2" />
                      Applications
                    </Button>
                    <Button 
                      variant={mainView === "Insights" ? "default" : "outline"} 
                      onClick={handleViewInsights}
                      className={mainView === "Insights" ? "bg-gray-900 hover:bg-gray-800" : ""}
                    >
                      <BarChart3 className="h-4 w-4 mr-2" />
                      Insights
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleOpenSettings}
                      className="border-gray-200"
                    >
                      <Settings className="h-4 w-4 mr-2" />
                      Email Notifications
                    </Button>

                    {/* Only show profile if authenticated */}
                    {isAuthenticated() && (
                    <div className="relative" ref={profileRef}>
                      <button
                        onClick={() => setIsProfileOpen(!isProfileOpen)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setIsProfileOpen(!isProfileOpen);
                          } else if (e.key === 'Escape') {
                            setIsProfileOpen(false);
                          }
                        }}
                        aria-expanded={isProfileOpen}
                        aria-haspopup="true"
                        aria-label="User menu"
                        className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors overflow-hidden"
                      >
                        {userInfo?.avatar_url ? (
                          <img 
                            src={userInfo.avatar_url} 
                            alt={userInfo.name || "User"} 
                            className="h-10 w-10 object-cover"
                          />
                        ) : userInfo?.name ? (
                          <span className="text-sm font-medium">
                            {userInfo.name.split(' ').map(n => n[0]).join('')}
                          </span>
                        ) : (
                          <User className="h-5 w-5 text-gray-600" />
                        )}
                      </button>

                      {isProfileOpen && (
                        <div 
                          className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-100 py-2 z-50"
                          role="menu"
                          aria-orientation="vertical"
                          aria-labelledby="user-menu"
                        >
                          {userInfo && (
                            <>
                              <div className="px-4 py-3 border-b border-gray-100">
                                <div className="flex items-center gap-3 mb-2">
                                  <div>
                                    <p className="font-medium text-gray-900">{userInfo.name}</p>
                                    <p className="text-sm text-gray-500 truncate max-w-[200px]">{userInfo.email}</p>
                                  </div>
                                </div>
                              </div>
                              <div className="px-2 py-2">
                                <button
                                  onClick={handleSignOut}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      handleSignOut();
                                    }
                                  }}
                                  role="menuitem"
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                >
                                  <LogOut className="h-4 w-4" />
                                  Sign out
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    )}
                  </div>
                </div>

                {mainView === "list" ? (
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
                    <div className="p-6">
                      {/* Filter section */}
                      <div className="flex flex-col md:flex-row justify-between gap-4 mb-6">
                        <div className="flex-1 mt-1">
                          <div className="flex justify-between items-center mb-1">
                            <Label htmlFor="search" className="text-sm font-medium text-gray-700">
                            Search Applications
                          </Label>
                            {searchInput && (
                              <button
                                onClick={() => setSearchInput("")}
                                className="text-xs text-primary hover:text-primary/80 transition-colors"
                              >
                                Clear search
                              </button>
                            )}
                          </div>
                          <Input
                            id="search"
                            placeholder="Search by name or category..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            className="mt-1 border-gray-200"
                          />
                        </div>
                        
                        <div className="flex flex-col md:flex-row gap-4">
                          <div className="min-w-[150px]">
                            <div className="flex justify-between items-center mb-1">
                              <Label className="text-sm font-medium text-gray-700">Category</Label>
                              {filterCategory && (
                                <button
                                  onClick={() => setFilterCategory(null)}
                                  className="text-xs text-primary hover:text-primary/80 transition-colors"
                                >
                                  Clear filter
                                </button>
                              )}
                            </div>
                            <select
                              className="w-full min-w-[300px] h-10 px-3 rounded-lg border border-gray-200 bg-white mt-1 text-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200 truncate"
                              value={filterCategory || ""}
                              onChange={(e) => {
                                if (!isAuthenticated()) {
                                  setShowLoginModal(true);
                                  return;
                                }
                                setFilterCategory(e.target.value || null);
                              }}
                            >
                              <option value="">All Categories</option>
                              {uniqueCategories.map((category) => (
                                <option key={category} value={category} className="truncate">
                                  {category}
                                </option>
                              ))}
                            </select>
                          </div>
                          
                            <div className="min-w-[150px]">
                              <div className="flex justify-between items-center mb-1">
                                <Label className="text-sm font-medium text-gray-700">Scope Risk</Label>
                                {filterRisk && (
                                  <button
                                    onClick={() => setFilterRisk(null)}
                                    className="text-xs text-primary hover:text-primary/80 transition-colors"
                                  >
                                    Clear filter
                                  </button>
                                )}
                              </div>
                              <select
                                className="w-full h-10 px-3 rounded-lg border border-gray-200 bg-white mt-1 text-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200"
                                value={filterRisk || ""}
                                onChange={(e) => setFilterRisk(e.target.value || null)}
                              >
                                <option value="">All Risk Levels</option>
                                <option value="Low">Low</option>
                                <option value="Medium">Medium</option>
                                <option value="High">High</option>
                              </select>
                            </div>
                          
                          <div className="min-w-[150px]">
                            <div className="flex justify-between items-center mb-1">
                              <Label className="text-sm font-medium text-gray-700">Managed Status</Label>
                              {filterManaged && (
                                <button
                                  onClick={() => setFilterManaged(null)}
                                  className="text-xs text-primary hover:text-primary/80 transition-colors"
                                >
                                  Clear filter
                                </button>
                              )}
                            </div>
                            <select
                              className="w-full h-10 px-3 rounded-lg border border-gray-200 bg-white mt-1 text-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200"
                              value={filterManaged || ""}
                              onChange={(e) => setFilterManaged(e.target.value || null)}
                            >
                              <option value="">All Statuses</option>
                              <option value="Managed">Managed</option>
                              <option value="Unmanaged">Unmanaged</option>
                              <option value="Needs Review">Needs Review</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                        <Table>
                            <TableHeader className="sticky top-0 bg-gray-50/80 backdrop-blur-sm z-10">
                              <TableRow className="border-b border-gray-100">
                                <TableHead className={`cursor-pointer rounded-tl-lg bg-transparent`} onClick={() => handleSort("name")}>
                                  <div className="flex items-center">
                                    Application
                                    {getSortIcon("name")}
                                  </div>
                                </TableHead>
                                <TableHead className={`cursor-pointer`} onClick={() => handleSort("category")}>
                                  <div className="flex items-center">
                                    Category
                                    {getSortIcon("category")}
                                  </div>
                                </TableHead>
                                <TableHead className={`text-center cursor-pointer`} onClick={() => handleSort("userCount")}>
                                  <div className="flex items-center justify-center">
                                    Users
                                    {getSortIcon("userCount")}
                                  </div>
                                </TableHead>
                                
                                  
                                    <TableHead className="text-center cursor-pointer" onClick={() => handleSort("riskLevel")}>
                                      <div className="flex items-center justify-center">
                                       Scope Risk
                                        {getSortIcon("riskLevel")}
                                      </div>
                                    </TableHead>
                                    <TableHead
                                      className="text-center cursor-pointer"
                                      onClick={() => handleSort("totalPermissions")}
                                    >
                                      <div className="flex items-center justify-center">
                                        Total Scope Permissions
                                        {getSortIcon("totalPermissions")}
                                      </div>
                                    </TableHead>
                                    <TableHead className="text-center cursor-pointer" onClick={() => handleSort("highRiskUserCount")}>
                                      <div className="flex items-center justify-center">
                                        High Risk Users
                                        {getSortIcon("highRiskUserCount")}
                                      </div>
                                    </TableHead>
                                
                                <TableHead className={`cursor-pointer`} onClick={() => handleSort("managementStatus")}>
                                  <div className="flex items-center">
                                  Managed Status
                                    {getSortIcon("managementStatus")}
                                  </div>
                                </TableHead>
                                <TableHead className={`text-center rounded-tr-lg`}>User Scope Analysis</TableHead>
                              </TableRow>
                            </TableHeader>
                          <TableBody>
                              {currentApps.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={9} className="text-center py-6 text-muted-foreground">
                                  No applications found matching your filters
                                </TableCell>
                              </TableRow>
                            ) : (
                                currentApps.map((app, index) => (
                                  <TableRow 
                                    key={app.id} 
                                    className={`${index % 2 === 0 ? "bg-muted/10" : ""} ${
                                      index === currentApps.length - 1 ? "last-row" : ""
                                    }`}
                                  >
                                  <TableCell>
                                    <div className="flex items-center gap-3">
                                      <AppIcon name={app.name} logoUrl={app.logoUrl} logoUrlFallback={app.logoUrlFallback} />
                                      <div 
                                        className="font-medium cursor-pointer hover:text-primary transition-colors truncate max-w-[200px]"
                                        onClick={() => handleSeeUsers(app.id)}
                                      >
                                        {app.name}
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <CategoryBadge 
                                      category={app.category} 
                                      appId={app.id} 
                                      isCategorizing={uncategorizedApps.has(app.id)} 
                                    />
                                  </TableCell>
                                  <TableCell className="text-center">
                                      <TooltipProvider>
                                        <Tooltip delayDuration={300}>
                                          <TooltipTrigger asChild>
                                    <div 
                                      className="flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
                                      onClick={() => handleSeeUsers(app.id)}
                                    >
                                      <div className="flex -space-x-2">
                                        {app.users.slice(0, 3).map((user, idx) => (
                                          <div
                                            key={idx}
                                            className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 border-2 border-background text-xs font-medium"
                                          >
                                            {user.name
                                              .split(" ")
                                              .map((n) => n[0])
                                              .join("")}
                                          </div>
                                        ))}
                                        {app.userCount > 3 && (
                                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 border-2 border-background text-xs font-medium">
                                            +{app.userCount - 3}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                          </TooltipTrigger>
                                          <TooltipContent side="right" className="p-2">
                                            <div className="max-h-48 overflow-y-auto space-y-1">
                                              {app.users.map((user, idx) => (
                                                <p key={idx} className="text-sm">{user.name}</p>
                                              ))}
                                            </div>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                  </TableCell>
                                  
                            
                                  <TableCell>
                                        <TooltipProvider>
                                            <Tooltip delayDuration={300}>
                                            <TooltipTrigger asChild>
                                              <div className="flex items-center justify-center cursor-pointer" onClick={() => handleSeeUsers(app.id)}>
                                                <RiskBadge level={app.riskLevel} />
                                              </div>
                                            </TooltipTrigger>
                                              <TooltipContent side="right" className="p-2">
                                                <p className="text-sm">{app.riskReason}</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      </TableCell>
                                      <TableCell className="text-center">
                                        <TooltipProvider>
                                            <Tooltip delayDuration={300}>
                                            <TooltipTrigger asChild>
                                              <div className="text-center cursor-pointer" onClick={() => handleSeeUsers(app.id)}>{app.totalPermissions}</div>
                                            </TooltipTrigger>
                                              <TooltipContent side="right" className="p-2">
                                                <div className="max-h-48 overflow-y-auto space-y-1">
                                                  {app.scopes.map((scope, idx) => (
                                                    <p key={idx} className="text-sm">{scope}</p>
                                                  ))}
                                                </div>
                                              </TooltipContent>
                                            </Tooltip>
                                          </TooltipProvider>
                                      </TableCell>    
                                    
                                      <TableCell className="text-center">
                                        <TooltipProvider>
                                          <Tooltip delayDuration={300}>
                                            <TooltipTrigger asChild>
                                              <div 
                                                className="text-center cursor-pointer flex items-center justify-center" 
                                                onClick={() => handleSeeUsers(app.id)}
                                              >
                                                {app.users.filter(user => transformRiskLevel(user.riskLevel) === "High").length}
                                                
                                              </div>
                                            </TooltipTrigger>
                                            <TooltipContent side="right" className="p-2">
                                              <p className="text-sm">
                                                {app.users.filter(user => transformRiskLevel(user.riskLevel) === "High").length} users with high risk level
                                              </p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      </TableCell>

                                  <TableCell>
                                    <select
                                      className="w-full h-8 rounded-md border border-gray-200 bg-white px-2 text-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200"
                                      value={editedStatuses[app.id] || app.managementStatus}
                                      onChange={(e) => {
                                        if (checkAuth(() => {
                                          handleStatusChange(app.id, e.target.value);
                                        })) {
                                          // If authenticated, update the UI immediately
                                          setEditedStatuses(prev => ({
                                            ...prev,
                                            [app.id]: e.target.value
                                          }));
                                        }
                                      }}
                                    >
                                      <option value="Managed">Managed</option>
                                      <option value="Unmanaged">Unmanaged</option>
                                      <option value="Needs Review">Needs Review</option>
                                    </select>
                                  </TableCell>
                                  <TableCell>
                                      <Button
                                      onClick={() => handleSeeUsers(app.id)}
                                        variant="outline"
                                        size="sm"
                                        className="w-full text-primary hover:text-primary border-primary/30 hover:border-primary hover:bg-primary/5 transition-all"
                                      >
                                        <Eye className="h-4 w-4 mr-2" />
                                        Deep Dive
                                      </Button>
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                      </div>

                      {/* Add pagination controls after the Table component */}
                      <div className="mt-4 flex items-center justify-between px-2">
                        <div className="text-sm text-muted-foreground">
                          Showing {startIndex + 1}-{Math.min(endIndex, sortedApps.length)} of {sortedApps.length} applications
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCurrentPage(1);
                              mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }}
                            disabled={currentPage === 1}
                          >
                            First
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCurrentPage(prev => Math.max(1, prev - 1));
                              mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }}
                            disabled={currentPage === 1}
                          >
                            Previous
                          </Button>
                          <div className="flex items-center space-x-1">
                            {getPageNumbers().map((page, index) => (
                              page === '...' ? (
                                <span key={`ellipsis-${index}`} className="px-2">...</span>
                              ) : (
                                <Button
                                  key={page}
                                  variant={currentPage === page ? "default" : "outline"}
                                  size="sm"
                                  onClick={() => {
                                    setCurrentPage(Number(page));
                                    mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                  }}
                                  className="w-8"
                                >
                                  {page}
                                </Button>
                              )
                            ))}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCurrentPage(prev => Math.min(totalPages, prev + 1));
                              mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }}
                            disabled={currentPage === totalPages}
                          >
                            Next
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCurrentPage(totalPages);
                              mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }}
                            disabled={currentPage === totalPages}
                          >
                            Last
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  // Replace the dashboard view section with the following:
                  // Dashboard view with charts - updated to match the requested charts
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* Application Distribution by Category */}
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                      <h3 className="text-lg font-medium text-gray-900">App Distribution by Category</h3>
                      <p className="text-sm text-gray-500 mb-4">
                        View application distribution across different categories within your organization.
                      </p>
                      <div className="h-80 flex items-center">
                        <ResponsiveContainer width="100%" height="100%">
                          <RechartsPieChart>
                            <Pie
                              data={getCategoryDistributionData()}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              fill="#8884d8"
                              dataKey="value"
                              nameKey="name"
                              paddingAngle={2}
                              strokeWidth={2}
                              stroke="#fff"
                              onClick={(data) => {
                                checkAuth(() => {
                                // Clear all filters first
                                setFilterRisk(null);
                                setFilterManaged(null);
                                // Set the new category filter
                                setFilterCategory(data.name);
                                setMainView("list");
                                });
                              }}
                              style={{ cursor: 'pointer' }}
                            >
                              {getCategoryDistributionData().map((entry, index) => (
                                <Cell 
                                  key={`cell-${index}`} 
                                  fill={entry.color}
                                  fillOpacity={1}
                                />
                              ))}
                            </Pie>
                            <Legend
                              layout="vertical"
                              align="right"
                              verticalAlign="middle"
                              formatter={(value, entry, index) => {
                                const item = getCategoryDistributionData()[index]
                                return (
                                  <span 
                                    className="text-gray-900 cursor-pointer hover:text-primary"
                                    onClick={() => {
                                      checkAuth(() => {
                                      // Clear all filters first
                                      setFilterRisk(null);
                                      setFilterManaged(null);
                                      // Set the new category filter
                                      setFilterCategory(value);
                                      setMainView("list");
                                      });
                                    }}
                                  >
                                    {value}{" "}
                                    <span className="text-gray-500 ml-4">
                                      {item.percentage}% ({item.value})
                                    </span>
                                  </span>
                                )
                              }}
                            />
                          </RechartsPieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    

                    {/* Apps by User Count */}
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-lg font-medium text-gray-900">Top Apps by User Count</h3>
                        <div>
                          <label htmlFor="managed-status-filter" className="mr-2 text-sm text-gray-700">Managed Status:</label>
                          <select
                            id="managed-status-filter"
                            value={chartManagedStatusFilter}
                            onChange={e => setChartManagedStatusFilter(e.target.value)}
                            className="border rounded px-2 py-1 text-sm"
                          >
                            <option value="Any Status">Any Status</option>
                            <option value="Managed">Managed</option>
                            <option value="Unmanaged">Unmanaged</option>
                            <option value="Needs Review">Needs Review</option>
                          </select>
                        </div>
                      </div>
                      <p className="text-sm text-gray-500 mb-4">Applications ranked by number of users</p>
                       {/* New structure for fixed X-axis chart */}
                       <div className="relative h-96">
                        {(() => {
                          const chartData = getAppsByUserCountChartData();
                          if (chartData.length === 0) {
                            return (
                              <div className="h-full flex items-center justify-center text-gray-500">
                                No apps that match this criteria
                              </div>
                            );
                          }
                          return (
                            <>
                              {/* Scrollable Bars Area (center part) */}
                              <div
                                className="absolute top-0 overflow-y-auto"
                                style={{
                                  left: `${Y_AXIS_WIDTH}px`,
                                  right: '0px',
                                  height: `${BAR_VIEWPORT_HEIGHT}px`,
                                }}
                              >
                                <ResponsiveContainer width="100%" height={Math.max(BAR_VIEWPORT_HEIGHT, chartData.length * BAR_THICKNESS_WITH_PADDING)}>
                                  <BarChart
                                    data={chartData}
                                    layout="vertical"
                                    margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
                                    syncId="topAppsByUserCountSync" // syncId for potential coordination
                                  >
                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#F0F0F0" />
                                    {/* No XAxis or YAxis here, they are separate */}
                                    <Bar
                                      dataKey="value"
                                      name="Users"
                                      radius={[0, 4, 4, 0]}
                                      barSize={20} // barSize is individual bar thickness, BAR_THICKNESS_WITH_PADDING is for layout
                                      strokeWidth={1}
                                      stroke="#fff"
                                      cursor="pointer"
                                      onClick={(data) => {
                                        const app = applications.find(a => a.name === data.name);
                                        if (app) {
                                          setMainView("list");
                                          setSelectedAppId(app.id);
                                          setIsUserModalOpen(true);
                                        }
                                      }}
                                    >
                                      {chartData.map((entry, index) => (
                                        <Cell
                                          key={`cell-${index}`}
                                          fill={entry.color}
                                          fillOpacity={1}
                                        />
                                      ))}
                                    </Bar>
                                    <RechartsTooltip
                                      formatter={(value) => [`${value} users`, ""]}
                                      contentStyle={{
                                        backgroundColor: 'white',
                                        border: '1px solid #E5E7EB',
                                        borderRadius: '8px',
                                        padding: '4px 12px',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                        fontFamily: 'inherit',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                      }}
                                      labelStyle={{ color: '#111827', fontWeight: 500, marginBottom: 0 }}
                                      itemStyle={{ color: '#111827', fontWeight: 600 }}
                                      separator=": "
                                      cursor={{ fill: "rgba(0, 0, 0, 0.05)" }}
                                    />
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>

                              {/* Fixed YAxis on the left */}
                              <div
                                className="absolute top-0 bg-white z-10" // bg-white and z-10 to ensure it's on top of grid lines from bar chart
                                style={{
                                  left: '0px',
                                  width: `${Y_AXIS_WIDTH}px`,
                                  height: `${BAR_VIEWPORT_HEIGHT}px`,
                                  borderRight: '1px solid #F0F0F0' // Optional: visual separator for Y-axis area
                                }}
                              >
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart
                                    data={chartData}
                                    layout="vertical"
                                    margin={{ top: 5, right: 5, left: 0, bottom: 5 }}
                                    syncId="topAppsByUserCountSync"
                                  >
                                    <YAxis
                                      dataKey="name"
                                      type="category"
                                      axisLine={false}
                                      tickLine={false}
                                      width={Y_AXIS_WIDTH - 10} // Full width minus some padding
                                      tick={{ fill: '#111827', fontSize: 12 }}
                                      interval={0} // Ensure all Y-axis ticks are rendered
                                    />
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>

                              {/* Fixed XAxis at the bottom */}
                              <div
                                className="absolute bottom-0 bg-white z-10" // bg-white and z-10
                                style={{
                                  left: `${Y_AXIS_WIDTH}px`,
                                  right: '0px',
                                  height: `${X_AXIS_HEIGHT}px`,
                                  borderTop: '1px solid #F0F0F0' // Optional: visual separator
                                }}
                              >
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 0 }} syncId="topAppsByUserCountSync">
                                    <XAxis
                                      type="number"
                                      dataKey="value" // Ensure XAxis uses the same dataKey as bars
                                      axisLine={false}
                                      tickLine={false}
                                      tick={{ fill: '#111827', fontSize: 12 }}
                                      // domain={[0, 'auto']} // Let Recharts determine domain or set explicitly if needed
                                      // ticks={[0, 8, 16, 24, 32]} // Can set explicit ticks if desired
                                    />
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    </div>

                  
                      
                        {/* Risk Level Distribution */}
                        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                          <h3 className="text-lg font-medium text-gray-900">Scope Risk Level Distribution</h3>
                          <p className="text-sm text-gray-500 mb-4">Number of applications by scope risk level</p>
                          <div className="h-80">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={getRiskChartData()} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
                                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#111827', fontSize: 12 }} />
                                <YAxis
                                  dataKey="name"
                                  type="category"
                                  axisLine={false}
                                  tickLine={false}
                                  width={80} 
                                  tick={(props) => {
                                    const { x, y, payload } = props;
                                    return (
                                      <g transform={`translate(${x},${y})`}>
                                        <text
                                          x={-3}
                                          y={0}
                                          dy={4}
                                          textAnchor="end"
                                          fill="#111827"
                                          fontSize={12}
                                          className="cursor-pointer hover:fill-primary transition-colors"
                                          onClick={() => {
                                            // Clear all filters first
                                            setFilterCategory(null);
                                            setFilterManaged(null);
                                            // Set the new risk filter
                                            setFilterRisk(payload.value);
                                            setMainView("list");
                                          }}
                                        >
                                          {payload.value}
                                        </text>
                                      </g>
                                    );
                                  }}
                                />
                                <Bar 
                                  dataKey="value" 
                                  name="Applications" 
                                  radius={[0, 4, 4, 0]} 
                                  barSize={30}
                                  strokeWidth={1}
                                  stroke="#fff"
                                  cursor="pointer"
                                  onClick={(data) => {
                                    // Clear all filters first
                                    setFilterCategory(null);
                                    setFilterManaged(null);
                                    // Set the new risk filter
                                    setFilterRisk(data.name);
                                    setMainView("list");
                                  }}
                                >
                                  {getRiskChartData().map((entry, index) => (
                                    <Cell 
                                      key={`cell-${index}`} 
                                      fill={entry.color}
                                      fillOpacity={1}
                                    />
                                  ))}
                                </Bar>
                                <RechartsTooltip
                                  formatter={(value) => [`${value} applications`, ""]}
                                  contentStyle={{ 
                                    backgroundColor: 'white', 
                                    border: '1px solid #e5e7eb', 
                                  borderRadius: '8px', 
                                  padding: '4px 12px',
                                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                  fontFamily: 'inherit',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px'
                                }}
                                labelStyle={{ color: '#111827', fontWeight: 500, marginBottom: 0 }}
                                itemStyle={{ color: '#111827', fontWeight: 600 }}
                                separator=": "
                                cursor={{ fill: "rgba(0, 0, 0, 0.05)" }}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      {/* High Scope Risk Users chart */}
                      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-lg font-medium text-gray-900">High Scope Risk Users</h3>
                          <div>
                            <label htmlFor="high-risk-users-filter" className="mr-2 text-sm text-gray-700">Managed Status:</label>
                            <select
                              id="high-risk-users-filter"
                              value={highRiskUsersManagedStatusFilter}
                              onChange={e => setHighRiskUsersManagedStatusFilter(e.target.value)}
                              className="border rounded px-2 py-1 text-sm"
                            >
                              <option value="Any Status">Any Status</option>
                              <option value="Managed">Managed</option>
                              <option value="Unmanaged">Unmanaged</option>
                              <option value="Needs Review">Needs Review</option>
                            </select>
                          </div>
                        </div>
                        <p className="text-sm text-gray-500 mb-4">Applications ranked by number of high-risk users</p>
                        <div className="relative h-96">
                          {/* Chart container with fixed height and overflow for scrolling */}
                          <div className="absolute inset-0 flex flex-col">
                            {/* Scrollable area for the bars only */}
                            <div className="flex-grow overflow-y-auto pb-10">
                              {getHighRiskUsersByApp().filter(app => app.value > 0).length === 0 ? (
                                <div className="h-full flex items-center justify-center text-gray-500">
                                  No applications found with high-risk users
                                </div>
                              ) : (
                                <ResponsiveContainer width="100%" height={Math.max(400, getHighRiskUsersByApp().filter(app => app.value > 0).length * 30)}>
                                  <BarChart data={getHighRiskUsersByApp().filter(app => app.value > 0)} layout="vertical" margin={{ left: 150, bottom: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
                                    {/* Removed the XAxis from here - it will be rendered separately below */}
                                    <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#111827', fontSize: 12 }} />
                                    <YAxis
                                      dataKey="name"
                                      type="category"
                                      axisLine={false}
                                      tickLine={false}
                                      width={140}
                                      tick={{ fill: '#111827', fontSize: 12 }}
                                    />
                                    <Bar 
                                      dataKey="value" 
                                      name="High-Risk Users" 
                                      radius={[0, 4, 4, 0]} 
                                      barSize={20}
                                      strokeWidth={1}
                                      stroke="#fff"
                                      cursor="pointer"
                                      onClick={(data) => {
                                        const app = applications.find(a => a.name === data.name);
                                        if (app) {
                                          setMainView("list");
                                          setSelectedAppId(app.id);
                                          setIsUserModalOpen(true);
                                        }
                                      }}
                                    >
                                      {getHighRiskUsersByApp().filter(app => app.value > 0).map((entry, index) => (
                                        <Cell 
                                          key={`cell-${index}`} 
                                          fill={entry.color}  
                                          fillOpacity={1}
                                        />
                                      ))}
                                    </Bar>
                                    <RechartsTooltip
                                      formatter={(value) => [`${value} high-risk ${value === 1 ? 'user' : 'users'}`, ""]}
                                      contentStyle={{ 
                                        backgroundColor: 'white', 
                                        border: '1px solid #e5e7eb', 
                                        borderRadius: '8px', 
                                        padding: '4px 12px',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                        fontFamily: 'inherit',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                      }}
                                      labelStyle={{ color: '#111827', fontWeight: 500, marginBottom: 0 }}
                                      itemStyle={{ color: '#111827', fontWeight: 600 }}
                                      separator=": "
                                      cursor={{ fill: "rgba(0, 0, 0, 0.05)" }}
                                    />
                                  </BarChart>
                                </ResponsiveContainer>
                              )}
                            </div>
                            
                            {/* Fixed x-axis at the bottom */}
                            <div className="h-8 relative bg-white flex items-center border-t border-gray-200">
                              <div className="absolute left-[150px] right-0 flex justify-between px-4">
                                {[0, 5, 10, 15, 20].map((value) => (
                                  <div key={value} className="flex flex-col items-center">
                                    <div className="h-2 w-px bg-gray-300 mb-1"></div>
                                    <span className="text-xs text-gray-500">{value}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="absolute right-0 top-6 text-xs text-gray-500 font-medium">
                                High-Risk Users
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Apps by Scope Permissions */}
                      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-lg font-medium text-gray-900">Top Apps by Scope Permissions</h3>
                          <div>
                            <label htmlFor="scope-permissions-filter" className="mr-2 text-sm text-gray-700">Managed Status:</label>
                            <select
                              id="scope-permissions-filter"
                              value={scopePermissionsManagedStatusFilter}
                              onChange={e => setScopePermissionsManagedStatusFilter(e.target.value)}
                              className="border rounded px-2 py-1 text-sm"
                            >
                              <option value="Any Status">Any Status</option>
                              <option value="Managed">Managed</option>
                              <option value="Unmanaged">Unmanaged</option>
                              <option value="Needs Review">Needs Review</option>
                            </select>
                          </div>
                        </div>
                        <p className="text-sm text-gray-500 mb-4">Applications ranked by number of scope permissions</p>
                        <div className="relative h-96">
                          {/* Chart container with fixed height and overflow for scrolling */}
                          <div className="absolute inset-0 flex flex-col">
                            {/* Scrollable area for the bars only */}
                            <div className="flex-grow overflow-y-auto pb-10">
                              {(() => {
                                const chartData = getTop10AppsByPermissions();
                                if (chartData.length === 0) {
                                  return (
                                    <div className="h-full flex items-center justify-center text-gray-500">
                                      No apps that match this criteria
                                    </div>
                                  );
                                }
                                return (
                                  <ResponsiveContainer width="100%" height={Math.max(350, chartData.length * 30)}>
                                    <BarChart data={chartData} layout="vertical" margin={{ left: 150, bottom: 20 }}>
                                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
                                      {/* Removed the XAxis from here - it will be rendered separately below */}
                                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#111827', fontSize: 12 }} />
                                      <YAxis
                                        dataKey="name"
                                        type="category"
                                        axisLine={false}
                                        tickLine={false}
                                        width={140}
                                        tick={{ fill: '#111827', fontSize: 12 }}
                                      />
                                      <Bar 
                                        dataKey="value" 
                                        name="Permissions" 
                                        radius={[0, 4, 4, 0]} 
                                        barSize={20}
                                        strokeWidth={1}
                                        stroke="#fff"
                                        cursor="pointer"
                                        onClick={(data) => {
                                          const app = applications.find(a => a.name === data.name);
                                          if (app) {
                                            setMainView("list");
                                            setSelectedAppId(app.id);
                                            setIsUserModalOpen(true);
                                          }
                                        }}
                                      >
                                        {chartData.map((entry, index) => (
                                          <Cell 
                                            key={`cell-${index}`} 
                                            fill={entry.color} 
                                            fillOpacity={1}
                                          />
                                        ))}
                                      </Bar>
                                      <RechartsTooltip
                                        formatter={(value) => [`${value} permissions`, ""]}
                                        contentStyle={{ 
                                          backgroundColor: 'white', 
                                          border: '1px solid #e5e7eb', 
                                          borderRadius: '8px', 
                                          padding: '4px 12px',
                                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                          fontFamily: 'inherit',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '8px'
                                        }}
                                        labelStyle={{ color: '#111827', fontWeight: 500, marginBottom: 0 }}
                                        itemStyle={{ color: '#111827', fontWeight: 600 }}
                                        separator=": "
                                        cursor={{ fill: "rgba(0, 0, 0, 0.05)" }}
                                      />
                                    </BarChart>
                                  </ResponsiveContainer>
                                );
                              })()}
                            </div>
                            
                            {/* Fixed x-axis at the bottom */}
                            <div className="h-8 relative bg-white flex items-center border-t border-gray-200">
                              <div className="absolute left-[150px] right-0 flex justify-between px-4">
                                {[0, 5, 10, 15, 20].map((value) => (
                                  <div key={value} className="flex flex-col items-center">
                                    <div className="h-2 w-px bg-gray-300 mb-1"></div>
                                    <span className="text-xs text-gray-500">{value}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="absolute right-0 top-6 text-xs text-gray-500 font-medium">
                                Permissions
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    
                  

                  {/* Application Similarity Groups */}
                  
                    {/* <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 col-span-2">
                      <h3 className="text-lg font-medium text-gray-900">Application Similarity Groups</h3>
                      <p className="text-sm text-gray-500 mb-4">
                        Groups of applications that share similar characteristics and usage patterns.
                      </p>
                      <div className="h-[500px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={applications.map(app => ({
                              name: app.name,
                              users: app.userCount,
                              permissions: app.totalPermissions,
                              similar: getSimilarApps(app, applications).length,
                              category: appCategories[app.id] || app.category,
                            }))}
                            layout="vertical"
                            margin={{ left: 150, right: 20, top: 20, bottom: 20 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                            <XAxis type="number" />
                            <YAxis
                              type="category"
                              dataKey="name"
                              width={140}
                              tick={({ x, y, payload }) => (
                                <g transform={`translate(${x},${y})`}>
                                  <text
                                    x={-3}
                                    y={0}
                                    dy={4}
                                    textAnchor="end"
                                    fill="#111827"
                                    fontSize={12}
                                    className="cursor-pointer hover:fill-primary transition-colors"
                                    onClick={() => {
                                      const app = applications.find(a => a.name === payload.value);
                                      if (app) {
                                        setMainView("list");
                                        setSelectedAppId(app.id);
                                        setIsUserModalOpen(true);
                                      }
                                    }}
                                  >
                                    {payload.value}
                                  </text>
                                </g>
                              )}
                            />
                            <Bar
                              dataKey="users"
                              stackId="a"
                              name="Users"
                              fill="#4B5563"
                              radius={[0, 4, 4, 0]}
                            >
                              {applications.map((app, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={getCategoryColor(app.category)}
                                  fillOpacity={0.8}
                                  cursor="pointer"
                                  onClick={() => {
                                    setMainView("list");
                                    setSelectedAppId(app.id);
                                    setIsUserModalOpen(true);
                                  }}
                                />
                              ))}
                            </Bar>
                            <RechartsTooltip
                              content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                  const app = applications.find(a => a.name === label);
                                  if (!app) return null;

                                  const similarApps = getSimilarApps(app, applications);
                                  return (
                                    <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-sm">
                                      <p className="font-medium">{label}</p>
                                      <p className="text-sm text-gray-500">{app.category}</p>
                                      <div className="text-sm mt-2">
                                        <div className="font-medium">Similar Apps:</div>
                                        <div className="mt-1 space-y-1">
                                          {similarApps.map(({ app: similarApp, score }, index) => (
                                            <div key={index} className="flex items-center gap-2">
                                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getCategoryColor(similarApp.category) }} />
                                              <span>{similarApp.name}</span>
                                              <span className="text-gray-500">({Math.round(score * 100)}% match)</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                              cursor={{ fill: "rgba(0, 0, 0, 0.05)" }}
                            />
                            <Legend />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div> */}
                  
                </div>
              )}
            </div>
          ) : (
            // User detail view
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-medium text-gray-800">
                    {(() => {
                      // Count how many filters are active
                      const activeFilters = [filterCategory, filterRisk, filterManaged].filter(Boolean).length;
                      
                      if (activeFilters === 0) {
                        return `We found ${sortedApps.length} applications.`;
                      }

                      // Single filter messages
                      if (activeFilters === 1) {
                        if (filterCategory) {
                          return `We found ${sortedApps.length} applications in ${filterCategory}.`;
                        }
                        if (filterRisk) {
                          return `We found ${sortedApps.length} ${filterRisk.toLowerCase()} risk applications.`;
                        }
                        if (filterManaged) {
                          return `We found ${sortedApps.length} ${filterManaged.toLowerCase()} applications.`;
                        }
                      }

                      // Multiple filters - show total count with "filtered"
                      return `We found ${sortedApps.length} filtered applications.`;
                    })()}
                  </h2>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant={mainView === "list" ? "default" : "outline"} 
                    onClick={() => {
                      setMainView("list");
                      handleCloseUserModal();
                    }}
                    className={mainView === "list" ? "bg-gray-900 hover:bg-gray-800" : ""}
                  >
                    <LayoutGrid className="h-4 w-4 mr-2" />
                    Applications
                  </Button>
                  <Button 
                    variant={mainView === "Insights" ? "default" : "outline"} 
                    onClick={handleViewInsights}
                    className={mainView === "Insights" ? "bg-gray-900 hover:bg-gray-800" : ""}
                  >
                    <BarChart3 className="h-4 w-4 mr-2" />
                    Insights
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleOpenSettings}
                    className="border-gray-200"
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    Email Notifications
                  </Button>

                  {/* Only show profile if authenticated */}
                  {isAuthenticated() && (
                  <div className="relative" ref={profileRef}>
                    <button
                      onClick={() => setIsProfileOpen(!isProfileOpen)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setIsProfileOpen(!isProfileOpen);
                        } else if (e.key === 'Escape') {
                          setIsProfileOpen(false);
                        }
                      }}
                      aria-expanded={isProfileOpen}
                      aria-haspopup="true"
                      aria-label="User menu"
                      className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors overflow-hidden"
                    >
                      {userInfo?.avatar_url ? (
                        <img 
                          src={userInfo.avatar_url} 
                          alt={userInfo.name || "User"} 
                          className="h-10 w-10 object-cover"
                        />
                      ) : userInfo?.name ? (
                        <span className="text-sm font-medium">
                          {userInfo.name.split(' ').map(n => n[0]).join('')}
                        </span>
                      ) : (
                        <User className="h-5 w-5 text-gray-600" />
                      )}
                    </button>

                    {isProfileOpen && (
                      <div 
                        className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-100 py-2 z-50"
                        role="menu"
                        aria-orientation="vertical"
                        aria-labelledby="user-menu"
                      >
                        {userInfo && (
                          <>
                            <div className="px-4 py-3 border-b border-gray-100">
                              <div className="flex items-center gap-3 mb-2">
                                <div>
                                  <p className="font-medium text-gray-900">{userInfo.name}</p>
                                  <p className="text-sm text-gray-500 truncate max-w-[200px]">{userInfo.email}</p>
                                </div>
                              </div>
                            </div>
                            <div className="px-2 py-2">
                              <button
                                onClick={handleSignOut}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleSignOut();
                                  }
                                }}
                                role="menuitem"
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors"
                              >
                                <LogOut className="h-4 w-4" />
                                Sign out
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
                <div className="p-6">
                {selectedApp && (
                  <>
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCloseUserModal}
                          className="flex items-center gap-1 text-gray-700 hover:bg-gray-100"
                        >
                          <ArrowLeft className="h-4 w-4" />
                          <span>Back</span>
                        </Button>
                        <div>
                          <h2 className="text-xl font-bold">{selectedApp.name}</h2>
                          <p className="text-sm text-muted-foreground">{selectedApp.userCount} users with access</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        
                          <div className="flex items-center gap-1">
                            <span className="text-sm text-muted-foreground font-medium">Risk:</span>
                            <RiskBadge level={selectedApp.riskLevel} />
                          </div>
                    
                        <div className="flex items-center gap-1">
                          <span className="text-sm text-muted-foreground font-medium">Managed Status:</span>
                          <select
                              className="h-8 rounded-md border border-gray-200 bg-white px-2 text-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200"
                            value={editedStatuses[selectedApp.id] || selectedApp.managementStatus}
                            onChange={(e) => handleStatusChange(selectedApp.id, e.target.value)}
                          >
                            <option value="Managed">Managed</option>
                            <option value="Unmanaged">Unmanaged</option>
                            <option value="Needs Review">Needs Review</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* App Details Card */}
                    <div className="mb-6 p-5 rounded-lg bg-gray-50 border border-gray-200">
                      <h3 className="text-sm font-semibold mb-2">Application Details</h3>
                      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <dt className="text-muted-foreground font-medium">Category</dt>
                          <dd className="font-medium">{selectedApp.category}</dd>
                        </div>
                        
                          <div>
                            <dt className="text-muted-foreground font-medium">Total Scope Permissions</dt>
                            <dd className="font-medium">{selectedApp.totalPermissions}</dd>
                          </div>
                      
                        <div>
                          <dt className="text-muted-foreground font-medium">Owner</dt>
                          <dd className="font-medium">{selectedApp.ownerEmail || "Not assigned"}</dd>
                        </div>
                      </dl>
                    </div>

                    <Tabs defaultValue="users" className="mb-6">
                      <TabsList className="bg-gray-100 p-1">
                        <TabsTrigger value="users" className="data-[state=active]:bg-white data-[state=active]:shadow-sm hover:bg-gray-200 data-[state=active]:hover:bg-white">
                        All Users
                        </TabsTrigger>
                        <TabsTrigger value="scopes" className="data-[state=active]:bg-white data-[state=active]:shadow-sm hover:bg-gray-200 data-[state=active]:hover:bg-white">
                        Scope User Groups
                        </TabsTrigger>
                        {/* <TabsTrigger value="similar" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                          Similar Apps
                        </TabsTrigger> */}
                        <TabsTrigger value="notes" className="data-[state=active]:bg-white data-[state=active]:shadow-sm hover:bg-gray-200 data-[state=active]:hover:bg-white">
                          Notes
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="users">
                        <div className="flex flex-col md:flex-row justify-between gap-4 mb-6">
                          <div className="flex-1">
                            <Label htmlFor="userSearch" className="text-sm font-medium">
                              Search Users
                            </Label>
                            <Input
                              id="userSearch"
                              placeholder="Search by name or email..."
                              value={userSearchTerm}
                              onChange={(e) => setUserSearchTerm(e.target.value)}
                              className="mt-1"
                            />
                          </div>
                        </div>

                        <div className="rounded-md border">
                            <div className="max-h-[800px] overflow-y-auto">
                          <Table>
                                <TableHeader className="sticky top-0 bg-gray-50/80 backdrop-blur-sm z-10">
                              <TableRow>
                                    <TableHead className="w-[50px] rounded-tl-lg bg-transparent">#</TableHead>
                                    <TableHead 
                                      className="w-[200px] cursor-pointer bg-transparent" 
                                      onClick={() => handleUserSort("name")}
                                    >
                                      <div className="flex items-center">
                                        User
                                        {getUserSortIcon("name")}
                                      </div>
                                    </TableHead>
                                    <TableHead 
                                      className="cursor-pointer bg-transparent"
                                      onClick={() => handleUserSort("email")}
                                    >
                                      <div className="flex items-center">
                                        Email
                                        {getUserSortIcon("email")}
                                      </div>
                                    </TableHead>

                                    <TableHead 
                                      className="cursor-pointer rounded-tr-lg bg-transparent"
                                      onClick={() => handleUserSort("riskLevel")}
                                    >
                                      <div className="flex items-center">
                                      User Scope Risk
                                        {getUserSortIcon("riskLevel")}
                                      </div>
                                    </TableHead>
                                  
                                    <TableHead className="bg-transparent">Scope Permissions</TableHead>
                                    
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                                  {currentUsers.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                                    No users found matching your search
                                  </TableCell>
                                </TableRow>
                              ) : (
                                    currentUsers.map((user, index) => (
                                  <TableRow key={user.id} className={index % 2 === 0 ? "bg-muted/30" : ""}>
                                        <TableCell className="text-muted-foreground">{userStartIndex + index + 1}</TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-2">
                                        <Avatar className="h-8 w-8">
                                          <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                                            {user.name
                                              .split(" ")
                                              .map((n) => n[0])
                                              .join("")}
                                          </AvatarFallback>
                                        </Avatar>
                                        <span className="font-medium">{user.name}</span>
                                      </div>
                                    </TableCell>
                                    <TableCell>{user.email}</TableCell>
                                    <TableCell>
                                      <TooltipProvider>
                                        <Tooltip delayDuration={300}>
                                          <TooltipTrigger asChild>
                                            <div className="flex items-center ml-4">
                                              <RiskBadge level={user.riskLevel} scopes={user.scopes} />
                                            </div>
                                          </TooltipTrigger>
                                          <TooltipContent side="right" className="p-2">
                                            <p className="text-xs">{user.riskReason}</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    </TableCell>
                                    <TableCell>
                                      <div className="max-h-24 overflow-y-auto text-sm">
                                        {user.scopes.map((scope, i) => {
                                          // Use the centralized risk assessment function
                                          const scopeRiskLevel = evaluateSingleScopeRisk(scope);
                                          
                                          // Use the centralized color function
                                          const riskColor = getRiskLevelColor(scopeRiskLevel);
                                          const riskStatus = `${transformRiskLevel(scopeRiskLevel)}-Risk Scope`;
                                          
                                          return (
                                            <div key={i} className="py-1 border-b border-muted last:border-0 flex items-center">
                                              <TooltipProvider>
                                                <Tooltip delayDuration={300}>
                                                  <TooltipTrigger asChild>
                                                    <div 
                                                      className="w-2 h-2 rounded-full mr-2 flex-shrink-0 cursor-pointer" 
                                                      style={{ backgroundColor: riskColor }}
                                                    />
                                                  </TooltipTrigger>
                                                  <TooltipContent side="left" className="p-2">
                                                    <p className="text-xs font-medium">{riskStatus}</p>
                                                  </TooltipContent>
                                                </Tooltip>
                                              </TooltipProvider>
                                              <span className="truncate">{scope}</span>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ))
                              )}
                            </TableBody>
                          </Table>
                            </div>

                            {/* User pagination controls */}
                            <div className="mt-4 flex items-center justify-between px-4 py-2 border-t border-gray-200">
                              <div className="text-sm text-muted-foreground">
                                Showing {userStartIndex + 1}-{Math.min(userEndIndex, filteredUsers.length)} of {filteredUsers.length} users
                              </div>
                              <div className="flex items-center space-x-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setUserCurrentPage(1)}
                                  disabled={userCurrentPage === 1}
                                >
                                  First
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setUserCurrentPage(prev => Math.max(1, prev - 1))}
                                  disabled={userCurrentPage === 1}
                                >
                                  Previous
                                </Button>
                                <div className="flex items-center space-x-1">
                                  {getUserPageNumbers().map((page, index) => (
                                    page === '...' ? (
                                      <span key={`ellipsis-${index}`} className="px-2">...</span>
                                    ) : (
                                      <Button
                                        key={page}
                                        variant={userCurrentPage === page ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => setUserCurrentPage(Number(page))}
                                        className="w-8"
                                      >
                                        {page}
                                      </Button>
                                    )
                                  ))}
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setUserCurrentPage(prev => Math.min(totalUserPages, prev + 1))}
                                  disabled={userCurrentPage === totalUserPages}
                                >
                                  Next
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setUserCurrentPage(totalUserPages)}
                                  disabled={userCurrentPage === totalUserPages}
                                >
                                  Last
                                </Button>
                              </div>
                            </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="scopes">
                        <div className="p-5 border border-gray-200 rounded-md bg-white">
                          <h3 className="text-lg font-medium mb-4">Scope User Groups</h3>
                          <p className="text-sm text-black mb-4">
                            Users are grouped by identical scope permission sets. Each user group represents a unique set of permissions.
                          </p>

                            {(() => {
                              const scopeGroups = getScopeGroups(selectedApp)
                              const totalScopePages = Math.ceil(scopeGroups.length / itemsPerPage)
                              const scopeStartIndex = (scopeCurrentPage - 1) * itemsPerPage
                              const scopeEndIndex = scopeStartIndex + itemsPerPage
                              const currentScopeGroups = scopeGroups.slice(scopeStartIndex, scopeEndIndex)

                              return (
                                <>
                                  {/* First box - All Application Scopes */}
                                  <div className="mb-6 border rounded-md overflow-hidden">
                                    <div className="p-3 flex justify-between items-center border-b border-gray-200 bg-blue-50">
                                      <h4 className="font-medium">
                                        <span className="flex items-center">
                                          <Info className="h-4 w-4 mr-1 text-blue-600" />
                                          All Application Scopes
                                        </span>
                                      </h4>
                                      <Badge variant="default" className="bg-blue-600">
                                        {selectedApp?.scopes.length || 0} {(selectedApp?.scopes.length || 0) === 1 ? "permission" : "permissions"}
                                      </Badge>
                                    </div>

                                    <div className="p-3 border-b">
                                      <div className="max-h-60 overflow-y-auto">
                                        {selectedApp?.scopes.map((scope, scopeIndex) => {
                                          // Use the centralized risk assessment function
                                          const scopeRiskLevel = evaluateSingleScopeRisk(scope);
                                          
                                          // Use the centralized color function
                                          const riskColor = getRiskLevelColor(scopeRiskLevel);

                                          return (
                                            <div key={scopeIndex} className="py-1 border-b border-muted last:border-0 flex items-center">
                                              <div 
                                                className="w-2 h-2 rounded-full mr-2 flex-shrink-0" 
                                                style={{ backgroundColor: riskColor }}
                                              />
                                              <span className="text-sm">{scope}</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>

                                    <div className="p-3">
                                      <p className="text-sm text-muted-foreground">
                                        This represents all permissions the application could request from any user
                                      </p>
                                    </div>
                                  </div>

                                  {/* User Group boxes - skip the first "All Scopes" group */}
                                  {currentScopeGroups
                                    .filter(group => !group.isAllScopes)
                                    .map((group, groupIndex: number) => {
                                      // Determine highest risk level in this group
                                      const hasHighRisk = group.scopes.some((scope: string) => evaluateSingleScopeRisk(scope) === 'High');
                                      const hasMediumRisk = !hasHighRisk && group.scopes.some((scope: string) => evaluateSingleScopeRisk(scope) === 'Medium');

                                      return (
                                        <div key={groupIndex} className="mb-6 border rounded-md overflow-hidden">
                                          <div className="p-3 flex justify-between items-center border-b border-gray-200 bg-gray-50">
                                            <h4 className="font-medium">
                                              User Group {scopeStartIndex + groupIndex + 1} - {group.users.length} {group.users.length === 1 ? "user" : "users"}
                                            </h4>
                                            <div className="flex items-center gap-2">
                                              {hasHighRisk && (
                                                <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
                                                  Contains high-risk scopes
                                                </Badge>
                                              )}
                                              {hasMediumRisk && (
                                                <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">
                                                  Contains medium-risk scopes
                                                </Badge>
                                              )}
                                              <Badge variant="outline" className="bg-primary/10">
                                                {group.scopes.length} {group.scopes.length === 1 ? "permission" : "permissions"}
                                              </Badge>
                                            </div>
                                          </div>

                                          <div className="p-3 border-b">
                                            <h5 className="text-sm font-medium mb-2">Permissions:</h5>
                                            <div className="max-h-60 overflow-y-auto">
                                              {group.scopes.map((scope: string, scopeIndex: number) => {
                                                // Use the centralized risk assessment function
                                                const scopeRiskLevel = evaluateSingleScopeRisk(scope);
                                                
                                                // Use the centralized color function
                                                const riskColor = getRiskLevelColor(scopeRiskLevel);

                                                return (
                                                  <div key={scopeIndex} className="py-1 border-b border-muted last:border-0 flex items-center">
                                                    <div 
                                                      className="w-2 h-2 rounded-full mr-2 flex-shrink-0" 
                                                      style={{ backgroundColor: riskColor }}
                                                    />
                                                    <span className="text-sm">{scope}</span>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>

                                          <div className="p-3">
                                            <h5 className="text-sm font-medium mb-2">
                                              Users with this permission set:
                                            </h5>
                                            <div className="flex flex-wrap gap-2">
                                              {group.users.map((user: AppUser, userIndex: number) => (
                                                <div
                                                  key={userIndex}
                                                  className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-md border border-gray-200"
                                                >
                                                  <div className="flex items-center justify-center w-6 h-6 rounded-md bg-gray-200 text-xs font-medium text-gray-800">
                                                    {user.name
                                                      .split(" ")
                                                      .map((n: string) => n[0])
                                                      .join("")}
                                                  </div>
                                                  <span className="text-sm">{user.name}</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}

                                  {/* Scope Groups pagination controls */}
                                  {scopeGroups.length > itemsPerPage && (
                                    <div className="mt-4 flex items-center justify-between px-4 py-2 border-t border-gray-200">
                                      <div className="text-sm text-muted-foreground">
                                        Showing {scopeStartIndex + 1}-{Math.min(scopeEndIndex, scopeGroups.length)} of {scopeGroups.length} scope groups
                                      </div>
                                      <div className="flex items-center space-x-2">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => setScopeCurrentPage(1)}
                                          disabled={scopeCurrentPage === 1}
                                        >
                                          First
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => setScopeCurrentPage(prev => Math.max(1, prev - 1))}
                                          disabled={scopeCurrentPage === 1}
                                        >
                                          Previous
                                        </Button>
                                        <div className="flex items-center space-x-1">
                                          {getScopePageNumbers(totalScopePages).map((page, index) => (
                                            page === '...' ? (
                                              <span key={`ellipsis-${index}`} className="px-2">...</span>
                                            ) : (
                                              <Button
                                                key={page}
                                                variant={scopeCurrentPage === page ? "default" : "outline"}
                                                size="sm"
                                                onClick={() => setScopeCurrentPage(Number(page))}
                                                className="w-8"
                                              >
                                                {page}
                                              </Button>
                                            )
                                          ))}
                                        </div>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => setScopeCurrentPage(prev => Math.min(totalScopePages, prev + 1))}
                                          disabled={scopeCurrentPage === totalScopePages}
                                        >
                                          Next
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => setScopeCurrentPage(totalScopePages)}
                                          disabled={scopeCurrentPage === totalScopePages}
                                        >
                                          Last
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </>
                              )
                            })()}
                          </div>
                      </TabsContent>

                      {/* <TabsContent value="similar">
                        <div className="p-5 border border-gray-200 rounded-md bg-white">
                          <h3 className="text-lg font-medium mb-4">Similar Applications</h3>
                          <p className="text-sm text-muted-foreground mb-6">
                            Apps that share similar usage patterns with {selectedApp.name}, based on user behavior and functional overlap.
                          </p>

                          <div className="space-y-6">
                            {getSimilarApps(selectedApp, applications).map(({ app, score, reasons }) => (
                              <div key={app.id} className="p-4 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-3">
                                      <AppIcon name={app.name} logoUrl={app.logoUrl} logoUrlFallback={app.logoUrlFallback} />
                                      <div>
                                        <h4 className="font-medium">{app.name}</h4>
                                        <div className="flex items-center gap-2">
                                          <span className="text-sm text-muted-foreground">{app.category}</span>
                                          <span className="text-sm text-muted-foreground">•</span>
                                          <span className="text-sm font-medium text-primary">{Math.round(score * 100)}% match</span>
                                        </div>
                                      </div>
                                    </div>

                                   
                                    <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-gray-50 rounded-md">
                                      <div>
                                        <div className="text-sm text-muted-foreground">Shared Users</div>
                                        <div className="text-lg font-medium">
                                          {app.users.filter(u => 
                                            selectedApp.users.some(su => su.email === u.email)
                                          ).length}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-sm text-muted-foreground">Common Functions</div>
                                        <div className="text-lg font-medium">
                                          {Array.from(getAppFunctionality(app.scopes)).filter(f => 
                                            getAppFunctionality(selectedApp.scopes).has(f)
                                          ).length}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-sm text-muted-foreground">Active Users</div>
                                        <div className="text-lg font-medium">
                                          {app.users.length}
                                        </div>
                                      </div>
                                    </div>

                                    
                                    <div className="space-y-2">
                                      {reasons.map((reason, index) => (
                                        <div key={index} className="flex items-center gap-2">
                                          <div className="w-1.5 h-1.5 rounded-full bg-primary"></div>
                                          <span className="text-sm">{reason}</span>
                            </div>
                          ))}
                                    </div>
                                  </div>

                                  <div className="flex flex-col items-end gap-3">
                                    <RiskBadge level={app.riskLevel} />
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setSelectedAppId(app.id);
                                        setIsUserModalOpen(true);
                                      }}
                                      className="whitespace-nowrap"
                                    >
                                      <Eye className="h-4 w-4 mr-2" />
                                      View Details
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </TabsContent> */}

                      <TabsContent value="notes">
                        <div className="p-5 border border-gray-200 rounded-md bg-white">
                          <div className="space-y-4">
                            <div>
                              <Label htmlFor="owner" className="text-sm font-medium">
                                Owner Email
                              </Label>
                              <Input
                                id="owner"
                                placeholder="Enter owner email"
                                value={ownerEmail}
                                onChange={(e) => setOwnerEmail(e.target.value)}
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label htmlFor="notes" className="text-sm font-medium">
                                Notes
                              </Label>
                              <textarea
                                id="notes"
                                className="w-full min-h-[100px] p-3 rounded-md border border-input bg-background mt-1"
                                placeholder="Add notes about this application..."
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                              />
                            </div>
                            
                            {saveMessage && (
                              <div className={`p-3 rounded-md ${
                                saveMessage.type === "success" 
                                  ? "bg-green-50 text-green-700 border border-green-200" 
                                  : "bg-red-50 text-red-700 border border-red-200"
                              }`}>
                                {saveMessage.text}
                              </div>
                            )}
                            
                            <Button 
                              onClick={handleSaveNotesAndOwner} 
                              disabled={isSaving}
                            >
                              {isSaving ? "Saving..." : "Save Changes"}
                            </Button>
                          </div>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </>
                )}
                </div>
              </div>
            </div>
          )}
       </main>

      {/* Use the new SettingsModal component */}
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
      />

      <div className="max-w-[70rem] mx-auto px-4 sm:px-8">
          <h2 className="text-2xl font-semibold mb-8 sm:mb-14 text-gray-900 text-center mt-11">
          Complete visibility. Real control. All in one place
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8">
            <div className="flex flex-col p-8 bg-white rounded-xl shadow-sm border border-gray-100">
              <div className="bg-primary/10 rounded-full w-12 h-12 flex items-center justify-center mb-6">
                <ScanSearch className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Spot unauthorized apps instantly</h3>
              <p className="text-gray-600 text-sm leading-relaxed">
              Automatically detect all the AI and SaaS apps your employees are using across Google Workspace or Microsoft 365. Identify your org's managed apps and mark specific apps for review.
              </p>
            </div>
            <div className="flex flex-col p-8 bg-white rounded-xl shadow-sm border border-gray-100">
              <div className="relative">
            
              <div className="bg-primary/10 rounded-full w-12 h-12 flex items-center justify-center mb-6">
                <ShieldAlert className="h-6 w-6 text-primary" />
                </div>
              </div>
              <h3 className="text-lg font-semibold mb-2">Smart risk assessment</h3>
              <p className="text-gray-600 text-sm leading-relaxed">
              Get instant visibility into OAuth scopes and see clear risk indicators based on scope permissions per user.
              </p>
            </div>
            <div className="flex flex-col p-8 bg-white rounded-xl shadow-sm border border-gray-100">
              <div className="relative">
                <div className="absolute -top-3 -right-3">
                  <div className="bg-black text-white text-xs font-medium px-3 py-1 rounded-full flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13 3L4 14H13L11 21L20 10H11L13 3Z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Stitchflow Exclusive
                  </div>
                </div>
              <div className="bg-primary/10 rounded-full w-12 h-12 flex items-center justify-center mb-6">
                <ChartNoAxesCombined className="h-6 w-6 text-primary" />
                </div>
              </div>
              <h3 className="text-lg font-semibold mb-2">Granular insights</h3>
              <p className="text-gray-600 text-sm leading-relaxed">
              Track every user's permissions and activities for each app. View app insights by category, risk, and scope groups—all in one place. Catch risky behavior before it becomes a problem.
              </p>
            </div>
            <div className="flex flex-col p-8 bg-white rounded-xl shadow-sm border border-gray-100">
              <div className="relative">
                <div className="absolute -top-3 -right-3">
                  <div className="bg-black text-white text-xs font-medium px-3 py-1 rounded-full flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13 3L4 14H13L11 21L20 10H11L13 3Z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Stitchflow Exclusive
                  </div>
                </div>
              <div className="bg-primary/10 rounded-full w-12 h-12 flex items-center justify-center mb-6">
                <Bell className="h-6 w-6 text-primary" />
                </div>
              </div>
              <h3 className="text-lg font-semibold mb-2">Continuous monitoring & real-time alerts</h3>
              <p className="text-gray-600 text-sm leading-relaxed">
              Get notified when new apps or users appear, or when high-risk apps gain new users. Your environment, under control.
              </p>
            </div>
          </div>
      </div>

      <FAQ />

      <WhyStitchflow className="bg-[#FAF8FA] mb-8" />

      <FeedbackChat/>

      <footer className="bottom-0 left-0 right-0 flex justify-between items-center px-4 py-3 mt-4 bg-[#1a1a2e] text-white">
        <div className="flex items-center gap-4">
          <Link href="/" className="hover:text-blue-500 transition-colors">
            stitchflow.com
          </Link>
          <Link href="/privacy" className="hover:text-blue-500 transition-colors">
            Privacy Policy
          </Link>
          <Link href="/terms-of-service" className="hover:text-blue-500 transition-colors">
            Terms of Service
          </Link>
        </div>
        <a 
          href="mailto:contact@stitchflow.io" 
          className="hover:text-blue-500 transition-colors"
        >
          contact@stitchflow.io
        </a>
      </footer>

      

      {/* Update the custom styles */}
      <style jsx global>{`
        .last-row td:first-child {
          border-bottom-left-radius: 0.75rem;
        }
        .last-row td:last-child {
          border-bottom-right-radius: 0.75rem;
        }
        
        /* Custom scrollbar styles */
        .overflow-y-auto::-webkit-scrollbar {
          width: 6px;
        }
        
        .overflow-y-auto::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .overflow-y-auto::-webkit-scrollbar-thumb {
          background: #e5e7eb;
          border-radius: 3px;
        }
        
        .overflow-y-auto::-webkit-scrollbar-thumb:hover {
          background: #d1d5db;
        }

        /* Table styles */
        table {
          border-collapse: separate;
          border-spacing: 0;
        }

        th {
          font-weight: 500;
          color: #4b5563;
          background: transparent;
        }

        td {
          color: #374151;
        }

        tr:hover {
          background-color: rgba(0, 0, 0, 0.02);
        }

        /* Dropdown styles */
        select {
          appearance: none;
          background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
          background-position: right 0.5rem center;
          background-repeat: no-repeat;
          background-size: 1.5em 1.5em;
          padding-right: 2.5rem;
          min-width: 140px;
        }

        select:hover {
          border-color: #d1d5db;
        }

        select:focus {
          border-color: #9ca3af;
          box-shadow: 0 0 0 2px rgba(156, 163, 175, 0.2);
          outline: none;
        }

        select option {
          padding: 8px;
          background-color: white;
          color: #374151;
        }

        /* Button hover states */
        button:hover {
          background-color: rgba(0, 0, 0, 0.05);
        }

        button[data-state="active"] {
          background-color: #111827;
          color: white;
        }

        button[data-state="active"]:hover {
          background-color: #1f2937;
        }
      `}</style>
      {showLoginModal && <LoginModal error={loginError} />}
    </div>
  )
}

