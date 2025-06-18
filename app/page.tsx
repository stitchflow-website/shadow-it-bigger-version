"use client"

import React, { useState, useEffect, useMemo, useRef, use } from "react"
import Papa from "papaparse"
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
  ArrowRight,
  ArrowRightIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { WhyStitchflow } from "@/components/ui/demo";
import { Button } from "@/components/ui/button"
import Button_website from "@/components/ui/Button_website"
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

import { determineRiskLevel, transformRiskLevel, getRiskLevelColor, evaluateSingleScopeRisk, RiskLevel } from '@/lib/risk-assessment'; // Corrected import alias and added type import
import { useSearchParams } from "next/navigation"
import { LabelList } from "recharts"
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Application,
  AppUser,
  SortColumn,
  SortDirection,
  UserSortColumn,
  CategoryData,
  BarChartData,
  RiskData,
} from "@/types";
import { fetchData } from "@/app/lib/data"

// Type definitions

const X_AXIS_HEIGHT = 30;
const Y_AXIS_WIDTH = 150;
const CHART_TOTAL_HEIGHT = 384; // Corresponds to h-96
const BAR_VIEWPORT_HEIGHT = CHART_TOTAL_HEIGHT - X_AXIS_HEIGHT;
const BAR_THICKNESS_WITH_PADDING = 30;

// Helper function to truncate text
const truncateText = (text: string, maxLength: number = 20) => {
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + "...";
  }
  return text;
};

export default function ShadowITDashboard() {
  const router = useRouter();
  const initialData = use(fetchData());
  const [applications, setApplications] = useState<Application[]>(initialData)
  const [searchInput, setSearchInput] = useState("")
  const [filterCategory, setFilterCategory] = useState<string | null>(null)
  const [filterRisk, setFilterRisk] = useState<string | null>(null)
  const [filterManaged, setFilterManaged] = useState<string | null>(null)
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null)
  const [isUserModalOpen, setIsUserModalOpen] = useState(false)
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

  const [uncategorizedApps, setUncategorizedApps] = useState<Set<string>>(new Set())
  const [appCategories, setAppCategories] = useState<Record<string, string>>({})

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  
  // State for the "Top Apps by User Count" chart's managed status filter
  const [chartManagedStatusFilter, setChartManagedStatusFilter] = useState<string>('Any Status');

  // State for the "High Risk Users by App" chart's managed status filter
  const [highRiskUsersManagedStatusFilter, setHighRiskUsersManagedStatusFilter] = useState<string>('Any Status');

  // State for the "Apps by Scope Permissions" chart's managed status filter
  const [scopePermissionsManagedStatusFilter, setScopePermissionsManagedStatusFilter] = useState<string>('Any Status');

  const mainContentRef = useRef<HTMLDivElement>(null); // Added for scroll to top

  // Add states for owner email and notes editing
  const [ownerEmail, setOwnerEmail] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<{type: "success" | "error", text: string} | null>(null);

  useEffect(() => {
    setApplications(initialData);
  }, [initialData]);

  const handleSignOut = () => {
    // Mock sign out logic
    console.log("User signed out");
    window.location.reload();
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

  const isAuthenticated = () => true;

  const checkAuth = (action: () => void) => {
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
      // Update local state immediately
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
      "Analytics & Business Intelligence":   "#FBCFE8", // pink-200
      "Cloud Platforms & Infrastructure":    "#C7D2FE", // indigo-200
      "Customer Success & Support":          "#99F6E4", // teal-200
      "Design & Creative Tools":             "#F5D0FE", // fuchsia-200
      "Developer & Engineering Tools":       "#BFDBFE", // blue-200
      "Finance & Accounting":                "#FDE68A", // amber-200
      "Human Resources & People Management": "#D9F99D", // lime-200
      "IT Operations & Security":            "#FECACA", // red-200
      "Identity & Access Management":        "#DDD6FE", // violet-200
      "Productivity & Collaboration":        "#A7F3D0", // emerald-200
      "Project Management":                  "#FED7AA", // orange-200
      "Sales & Marketing":                   "#A5F3FC", // cyan-200
      Others:                                "#E5E7EB", // gray-200
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
    const initial = name ? name.charAt(0).toUpperCase() : '';
    const [primaryLogoError, setPrimaryLogoError] = useState(false);
    const [fallbackLogoError, setFallbackLogoError] = useState(false);

    // Generate a consistent background color based on app name
    const getBackgroundColor = (appName: string) => {
      if(!appName) return '#ccc';
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

    // Helper to convert app name to likely domain format
  function appNameToDomain(appName: string): string {
    if (!appName) return '';
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
    if (!appName) {
        return { primary: '', fallback: '' };
    }
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
    <div className="mx-auto font-sans text-gray-900 bg-[#f8f5f3]">

        

      <main className="pt-[40px] pl-10 pr-10 bg-white mt-4 pb-10">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-xl font-bold">Shadow IT Overview</h2>
              <Share url="https://www.stitchflow.com/tools/shadow-it-scan" />
            </div>

            {!selectedAppId ? (
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
                                  className="text-xs text-primary hover:text-primary/80 transition-colors ml-2"
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
                                          handleStatusChange(app.id, e.target.value);
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
                      <div className="h-96 overflow-y-auto">
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
                            <ResponsiveContainer width="100%" height={Math.max(350, chartData.length * 30)}>
                              <BarChart data={chartData} layout="vertical" margin={{ left: 150 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
                                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#111827', fontSize: 12 }} />
                                <YAxis
                                  dataKey="name"
                                  type="category"
                                  axisLine={false}
                                  tickLine={false}
                                  width={140}
                                  tick={{ fill: '#111827', fontSize: 12 }}
                                  tickFormatter={(value) => truncateText(value, 20)} // Added truncation
                                />
                                <Bar 
                                  dataKey="value" 
                                  name="Users" 
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
                                  <LabelList 
                                    dataKey="value" 
                                    position="right" 
                                    fill="#111827"
                                    fontSize={10}
                                    formatter={(value: number) => `${value}`}
                                    offset={4}
                                  />
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
                                          {truncateText(payload.value, 10)} {/* Apply truncation here */}
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
                        <div className="h-96 overflow-y-auto">
                          {getHighRiskUsersByApp().filter(app => app.value > 0).length === 0 ? (
                            <div className="h-full flex items-center justify-center text-gray-500">
                              No applications found with high-risk users
                            </div>
                          ) : (
                            <ResponsiveContainer width="100%" height={Math.max(400, getHighRiskUsersByApp().filter(app => app.value > 0).length * 30)}>
                              <BarChart data={getHighRiskUsersByApp().filter(app => app.value > 0)} layout="vertical" margin={{ left: 150 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
                                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#111827', fontSize: 12 }} />
                                <YAxis
                                  dataKey="name"
                                  type="category"
                                  axisLine={false}
                                  tickLine={false}
                                  width={140}
                                  tick={{ fill: '#111827', fontSize: 12 }}
                                  tickFormatter={(value) => truncateText(value, 20)} // Added truncation
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
                                  <LabelList 
                                    dataKey="value" 
                                    position="right" 
                                    fill="#111827"
                                    fontSize={10}
                                    formatter={(value: number) => `${value}`}
                                    offset={4}
                                  />
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
                        <div className="h-96 overflow-y-auto">
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
                                <BarChart data={chartData} layout="vertical" margin={{ left: 150 }}>
                                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
                                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#111827', fontSize: 12 }} />
                                  <YAxis
                                    dataKey="name"
                                    type="category"
                                    axisLine={false}
                                    tickLine={false}
                                    width={140}
                                    tick={{ fill: '#111827', fontSize: 12 }}
                                    tickFormatter={(value) => truncateText(value, 20)} // Added truncation
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
                                    <LabelList 
                                      dataKey="value" 
                                      position="right" 
                                      fill="#111827"
                                      fontSize={10}
                                      formatter={(value: number) => `${value}`}
                                      offset={4}
                                    />
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
                      </div>
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
    </div>
  )
}

