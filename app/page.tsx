"use client"

import { useState, useEffect, useMemo } from "react"
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
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

// Type definitions
type Application = {
  id: string
  name: string
  category: string
  userCount: number
  users: AppUser[]
  riskLevel: "Low" | "Medium" | "High"
  riskReason: string
  totalPermissions: number
  scopeVariance: { userGroups: number; scopeGroups: number }
  lastLogin: string
  managementStatus: "Managed" | "Unmanaged" | "Needs Review"
  ownerEmail: string
  notes: string
  scopes: string[]
  isInstalled: boolean
  isAuthAnonymously: boolean
}

type AppUser = {
  id: string
  appId: string
  name: string
  email: string
  lastActive: string
  scopes: string[]
  riskLevel: "Low" | "Medium" | "High"
  riskReason: string
}

// Sort types
type SortColumn =
  | "name"
  | "category"
  | "userCount"
  | "riskLevel"
  | "totalPermissions"
  | "lastLogin"
  | "managementStatus"
type SortDirection = "asc" | "desc"

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

export default function ShadowITDashboard() {
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
  const [mainView, setMainView] = useState<"list" | "trends">("list")
  const [currentPage, setCurrentPage] = useState(1)
  const [userCurrentPage, setUserCurrentPage] = useState(1)
  const [scopeCurrentPage, setScopeCurrentPage] = useState(1)
  const itemsPerPage = 20

  // Sorting state - default to showing apps with most users at top
  const [sortColumn, setSortColumn] = useState<SortColumn>("userCount")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

  const [userSortColumn, setUserSortColumn] = useState<"name" | "email" | "lastActive" | "riskLevel">("lastActive")
  const [userSortDirection, setUserSortDirection] = useState<SortDirection>("desc")

  const searchTerm = useDebounce(searchInput, 300)
  const debouncedUserSearchTerm = useDebounce(userSearchTerm, 300)

  // Add new state for settings
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [notificationSettings, setNotificationSettings] = useState({
    newAppDetected: true,
    userLimitExceeded: true,
    userLimitThreshold: "100",
    newUserInReviewApp: true,
    newUserInAnyApp: false,
    periodicReview: "3",
  })

  // Fetch and process data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        
        // Get orgId from URL params
        const urlParams = new URLSearchParams(window.location.search);
        const orgId = urlParams.get('orgId');
        
        if (!orgId) {
          // If no orgId, redirect to login
          window.location.href = '/login';
          return;
        }

        // Fetch applications from our API
        const response = await fetch(`/api/applications?orgId=${orgId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch applications');
        }

        const data = await response.json();
        setApplications(data);
        setIsLoading(false);
      } catch (error) {
        console.error("Error fetching application data:", error);
        setIsLoading(false);
        // Redirect to login on error
        window.location.href = '/login';
      }
    };

    fetchData();
  }, []);

  // Helper function to parse CSV row handling quoted values
  function parseCSVRow(row: string): string[] {
    const result = []
    let inQuotes = false
    let currentValue = ""

    for (let i = 0; i < row.length; i++) {
      const char = row[i]

      if (char === '"' && (i === 0 || row[i - 1] !== "\\")) {
        inQuotes = !inQuotes
      } else if (char === "," && !inQuotes) {
        result.push(currentValue)
        currentValue = ""
      } else {
        currentValue += char
      }
    }

    result.push(currentValue)
    return result
  }

  // Helper function to generate email from name
  function generateEmailFromName(name: string): string {
    return name.toLowerCase().replace(/\s+/g, ".") + "@company.com"
  }

  // Update the getCategoryFromScopes function to use the provided categories
  function getCategoryFromScopes(scopes: string[]): string {
    const scopeStr = scopes.join(" ").toLowerCase()
    console.log('Processing scopes:', scopeStr)
    
    // Analytics & Business Intelligence
    if (scopeStr.match(/analytics|bi|data|report|metric|dashboard|insight|statistic|measure/)) {
      return "Analytics & Business Intelligence"
    }
    
    // Cloud Platforms & Infrastructure
    if (scopeStr.match(/cloud|aws|azure|gcp|infra|server|host|deploy|container|kubernetes|docker/)) {
      return "Cloud Platforms & Infrastructure"
    }
    
    // Customer Success & Support
    if (scopeStr.match(/support|ticket|help|customer|service|chat|feedback|desk/)) {
      return "Customer Success & Support"
    }
    
    // Design & Creative Tools
    if (scopeStr.match(/design|creative|image|photo|video|media|art|graphic|figma|sketch/)) {
      return "Design & Creative Tools"
    }
    
    // Developer & Engineering Tools
    if (scopeStr.match(/dev|code|git|api|engineer|build|test|debug|repository|ci|cd/)) {
      return "Developer & Engineering Tools"
    }
    
    // Finance & Accounting
    if (scopeStr.match(/finance|accounting|payment|invoice|expense|budget|tax|bill|transaction/)) {
      return "Finance & Accounting"
    }
    
    // Human Resources & People Management
    if (scopeStr.match(/hr|people|employee|recruit|talent|hiring|onboard|payroll|attendance/)) {
      return "Human Resources & People Management"
    }
    
    // IT Operations & Security
    if (scopeStr.match(/it|security|admin|operation|monitor|log|audit|compliance|network/)) {
      return "IT Operations & Security"
    }
    
    // Identity & Access Management
    if (scopeStr.match(/identity|auth|access|login|sso|permission|role|user.management|directory/)) {
      return "Identity & Access Management"
    }
    
    // Productivity & Collaboration
    if (scopeStr.match(/gmail|calendar|meet|doc|sheet|slide|collab|message|chat|workspace/)) {
      return "Productivity & Collaboration"
    }
    
    // Project Management
    if (scopeStr.match(/project|task|manage|plan|agile|sprint|board|timeline|milestone/)) {
      return "Project Management"
    }
    
    // Sales & Marketing
    if (scopeStr.match(/sales|crm|lead|market|brand|campaign|social|email.market|ads/)) {
      return "Sales & Marketing"
    }

    return "Others"
  }

  // Helper function to determine risk level from scopes
  function getRiskLevelFromScopes(scopes: string[]): "Low" | "Medium" | "High" {
    const sensitiveScopes = [
      "https://www.googleapis.com/auth/gmail",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/admin",
      "https://www.googleapis.com/auth/cloud-platform",
    ]

    const moderateScopes = ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/contacts"]

    if (scopes.some((scope) => sensitiveScopes.some((s) => scope.includes(s)))) {
      return "High"
    } else if (scopes.some((scope) => moderateScopes.some((s) => scope.includes(s)))) {
      return "Medium"
    }
    return "Low"
  }

  // Helper function to generate risk reason from scopes
  function getRiskReasonFromScopes(scopes: string[]): string {
    if (scopes.some((s) => s.includes("gmail"))) {
      return "Has access to email data which may contain sensitive information."
    } else if (scopes.some((s) => s.includes("drive"))) {
      return "Has access to files and documents which may contain confidential data."
    } else if (scopes.some((s) => s.includes("admin"))) {
      return "Has administrative access which grants extensive control."
    } else if (scopes.some((s) => s.includes("calendar"))) {
      return "Has access to calendar data which may reveal organizational activities."
    } else if (scopes.some((s) => s.includes("contacts"))) {
      return "Has access to contact information."
    }
    return "Limited access to basic profile information."
  }

  // Sorting function
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      // Set new column and default to ascending
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
        app.category.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesRisk = filterRisk ? app.riskLevel === filterRisk : true
      const matchesManaged = filterManaged ? app.managementStatus === filterManaged : true
      const matchesCategory = filterCategory ? app.category === filterCategory : true

      return matchesSearch && matchesRisk && matchesManaged && matchesCategory
    })
  }, [applications, searchTerm, filterRisk, filterManaged, filterCategory])

  // Get unique categories for the filter dropdown
  const uniqueCategories = [...new Set(applications.map((app) => app.category))].sort()

  // Sort applications
  const sortedApps = [...filteredApps].sort((a, b) => {
    // Helper for numeric comparison with direction
    const compareNumeric = (valA: number, valB: number) => {
      return sortDirection === "asc" ? valA - valB : valB - valA
    }

    // Helper for string comparison with direction
    const compareString = (valA: string, valB: string) => {
      return sortDirection === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA)
    }

    // Helper for date comparison with direction
    const compareDate = (valA: string, valB: string) => {
      const dateA = new Date(valA).getTime()
      const dateB = new Date(valB).getTime()
      return sortDirection === "asc" ? dateA - dateB : dateB - dateA
    }

    // Sort based on column
    switch (sortColumn) {
      case "name":
        return compareString(a.name, b.name)
      case "category":
        return compareString(a.category, b.category)
      case "userCount":
        return compareNumeric(a.userCount, b.userCount)
      case "riskLevel": {
        const riskOrder = { Low: 1, Medium: 2, High: 3 }
        return compareNumeric(riskOrder[a.riskLevel], riskOrder[b.riskLevel])
      }
      case "totalPermissions":
        return compareNumeric(a.totalPermissions, b.totalPermissions)
      case "lastLogin":
        return compareDate(a.lastLogin, b.lastLogin)
      case "managementStatus": {
        const statusOrder = { Managed: 1, Unmanaged: 2, "Needs Review": 3 }
        return compareNumeric(statusOrder[a.managementStatus], statusOrder[b.managementStatus])
      }
      default:
        return 0
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

      const compareDate = (valA: string, valB: string) => {
        const dateA = new Date(valA).getTime()
        const dateB = new Date(valB).getTime()
        return userSortDirection === "asc" ? dateA - dateB : dateB - dateA
      }

      switch (userSortColumn) {
        case "name":
          return compareString(a.name, b.name)
        case "email":
          return compareString(a.email, b.email)
        case "lastActive":
          return compareDate(a.lastActive, b.lastActive)
        case "riskLevel": {
          const riskOrder = { Low: 1, Medium: 2, High: 3 }
          return userSortDirection === "asc" 
            ? riskOrder[a.riskLevel] - riskOrder[b.riskLevel]
            : riskOrder[b.riskLevel] - riskOrder[a.riskLevel]
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

  // Handle opening user details
  const handleSeeUsers = (appId: string) => {
    setSelectedAppId(appId)
    setIsUserModalOpen(true)
  }

  // Handle closing user details
  const handleCloseUserModal = () => {
    setIsUserModalOpen(false)
    setSelectedAppId(null)
    setUserSearchTerm("")
  }

  // Handle status change
  const handleStatusChange = (appId: string, newStatus: string) => {
    setApplications((prevApps) =>
      prevApps.map((app) =>
        app.id === appId ? { ...app, managementStatus: newStatus as "Managed" | "Unmanaged" | "Needs Review" } : app,
      ),
    )
    setEditedStatuses((prev) => ({
      ...prev,
      [appId]: newStatus,
    }))
  }

  // Helper function to group users by identical scope sets
  function getScopeGroups(app: Application | null) {
    if (!app) return []

    // Create a map of scope sets to users
    const scopeGroups = new Map<string, { scopes: string[]; users: AppUser[] }>()

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
    return Array.from(scopeGroups.values())
  }

  // Chart data preparation functions
  const getCategoryChartData = (): CategoryData[] => {
    const categoryMap = new Map<string, number>()

    applications.forEach((app) => {
      categoryMap.set(app.category, (categoryMap.get(app.category) || 0) + 1)
    })

    const categoryColors: Record<string, string> = {
      "IT and Development": "#4285F4", // blue
      "Product management": "#34A853", // green
      Productivity: "#A4CAFE", // light blue
      "Finance and HR": "#673AB7", // purple
      "Marketing and Design": "#FBBC05", // yellow
      Sales: "#EA4335", // red
    }

    return Array.from(categoryMap.entries()).map(([name, value]) => ({
      name,
      value,
      color: categoryColors[name] || "#9AA0A6", // default to gray
    }))
  }

  const getAppsUsersBarData = (): BarChartData[] => {
    const categoryMap = new Map<string, { apps: number; users: number }>()

    applications.forEach((app) => {
      if (!categoryMap.has(app.category)) {
        categoryMap.set(app.category, { apps: 0, users: 0 })
      }

      const data = categoryMap.get(app.category)!
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
    return [...applications]
      .sort((a, b) => b.userCount - a.userCount)
      .slice(0, 10)
      .map((app) => ({
        name: app.name,
        value: app.userCount,
        color: getCategoryColor(app.category),
      }))
  }

  // Add a new function to get top 10 apps by scope permissions
  const getTop10AppsByPermissions = () => {
    return [...applications]
      .sort((a, b) => b.totalPermissions - a.totalPermissions)
      .slice(0, 10)
      .map((app) => ({
        name: app.name,
        value: app.totalPermissions,
        color: getCategoryColor(app.category),
      }))
  }

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
      categoryCount.set(app.category, (categoryCount.get(app.category) || 0) + 1)
    })

    const totalApps = applications.length

    return Array.from(categoryCount.entries()).map(([category, count]) => ({
      name: category,
      value: count,
      percentage: totalApps > 0 ? Math.round((count / totalApps) * 100) : 0,
      color: getCategoryColor(category),
    }))
  }

  // Get applications by category for the bar chart
  const getAppsByCategory = () => {
    const categoryCount = new Map<string, number>()

    applications.forEach((app) => {
      categoryCount.set(app.category, (categoryCount.get(app.category) || 0) + 1)
    })

    return Array.from(categoryCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({
        name: category,
        value: count,
        color: getCategoryColor(category),
      }))
  }

  // Update the getCategoryColor function for charts
  const getCategoryColor = (category: string): string => {
    const categoryColors: Record<string, string> = {
      "Analytics & Business Intelligence": "#64B5F6", // darker pastel blue
      "Cloud Platforms & Infrastructure": "#BA68C8", // darker pastel purple
      "Customer Success & Support": "#81C784", // darker pastel green
      "Design & Creative Tools": "#F06292", // darker pastel pink
      "Developer & Engineering Tools": "#9575CD", // darker pastel violet
      "Finance & Accounting": "#4DD0E1", // darker pastel cyan
      "Human Resources & People Management": "#4FC3F7", // darker pastel light blue
      "IT Operations & Security": "#FF8A65", // darker pastel coral
      "Identity & Access Management": "#FFD54F", // darker pastel amber
      "Productivity & Collaboration": "#9575CD", // darker pastel purple
      "Project Management": "#FFF176", // darker pastel yellow
      "Sales & Marketing": "#FFB74D", // darker pastel orange
      Others: "#BDBDBD", // darker light gray
    }

    return categoryColors[category] || "#BDBDBD"
  }

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

  // App Icon component
  const AppIcon = ({ name }: { name: string }) => {
    // Get the first letter of the app name
    const initial = name.charAt(0).toUpperCase()

    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-md bg-gray-100 text-gray-800 font-medium">
        {initial}
      </div>
    )
  }

  // Update the getCategoryColor function in the CategoryBadge component
  const CategoryBadge = ({ category }: { category: string }) => {
    const getCategoryColor = (category: string) => {
      const categoryColors: Record<string, string> = {
        "Analytics & Business Intelligence": "bg-blue-50 text-blue-700",
        "Cloud Platforms & Infrastructure": "bg-purple-50 text-purple-700",
        "Customer Success & Support": "bg-green-50 text-green-700",
        "Design & Creative Tools": "bg-pink-50 text-pink-700",
        "Developer & Engineering Tools": "bg-violet-50 text-violet-700",
        "Finance & Accounting": "bg-cyan-50 text-cyan-700",
        "Human Resources & People Management": "bg-sky-50 text-sky-700",
        "IT Operations & Security": "bg-red-50 text-red-700",
        "Identity & Access Management": "bg-amber-50 text-amber-700",
        "Productivity & Collaboration": "bg-purple-50 text-purple-700",
        "Project Management": "bg-yellow-50 text-yellow-700",
        "Sales & Marketing": "bg-orange-50 text-orange-700",
        Others: "bg-gray-50 text-gray-700",
      }

      return categoryColors[category] || "bg-gray-50 text-gray-700"
    }

    const displayName = category.length > 15 ? category.substring(0, 15) + "..." : category

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-sm font-medium w-full ${getCategoryColor(category)}`}>
              {displayName}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{category}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Risk Badge component
  function RiskBadge({ level }: { level: string }) {
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
      <div className={`flex items-center px-2 py-1 rounded-full ${colorMap[level]}`}>
        {iconMap[level]}
        <span>{level}</span>
      </div>
    )
  }

  // Date formatting function
  function formatDate(dateString: string): string {
    const date = new Date(dateString)

    // Format like "Mar 2, 2025, 1:29 AM"
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date)
  }

  // Handle user table sorting
  const handleUserSort = (column: "name" | "email" | "lastActive" | "riskLevel") => {
    if (userSortColumn === column) {
      setUserSortDirection(userSortDirection === "asc" ? "desc" : "asc")
    } else {
      setUserSortColumn(column)
      setUserSortDirection("asc")
    }
  }

  // Get sort icon for user table column header
  const getUserSortIcon = (column: "name" | "email" | "lastActive" | "riskLevel") => {
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
  const handleSettingChange = (setting: string, value: string | boolean) => {
    setNotificationSettings(prev => ({
      ...prev,
      [setting]: value
    }))
  }

  return (
    <div className="max-w-[1400px] mx-auto py-8 space-y-8 font-sans text-gray-900">
      <div className="flex flex-col space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Shadow IT Scanner</h1>
        <p className="text-gray-600 text-sm">
          Discover and track all the apps your employees use via your org's Google Workspace
        </p>
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
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-medium text-gray-800">Hey, we found {sortedApps.length} applications.</h2>
            </div>
            <div className="flex gap-2">
              <Button 
                variant={mainView === "list" ? "default" : "outline"} 
                onClick={() => setMainView("list")}
                className={mainView === "list" ? "bg-gray-900 hover:bg-gray-800" : ""}
              >
                <LayoutGrid className="h-4 w-4 mr-2" />
                Applications
              </Button>
              <Button 
                variant={mainView === "trends" ? "default" : "outline"} 
                onClick={() => setMainView("trends")}
                className={mainView === "trends" ? "bg-gray-900 hover:bg-gray-800" : ""}
              >
                <BarChart3 className="h-4 w-4 mr-2" />
                Trends
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsSettingsOpen(true)}
                className="border-gray-200"
              >
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>
            </div>
          </div>

          {mainView === "list" ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
              <div className="p-6">
                {/* Filter section */}
                <div className="flex flex-col md:flex-row justify-between gap-4 mb-6">
                  <div className="flex-1">
                    <Label htmlFor="search" className="text-sm font-medium text-gray-700">
                      Search Applications
                    </Label>
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
                      <Label className="text-sm font-medium text-gray-700">Category</Label>
                      <select
                        className="w-full h-10 px-3 rounded-lg border border-gray-200 bg-white mt-1 text-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200"
                        value={filterCategory || ""}
                        onChange={(e) => setFilterCategory(e.target.value || null)}
                      >
                        <option value="">All Categories</option>
                        {uniqueCategories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="min-w-[150px]">
                      <Label className="text-sm font-medium text-gray-700">Risk Level</Label>
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
                      <Label className="text-sm font-medium text-gray-700">App Status</Label>
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
                  <div className="max-h-[800px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-gray-50/80 backdrop-blur-sm z-10">
                        <TableRow className="border-b border-gray-100">
                          <TableHead className="w-[250px] cursor-pointer rounded-tl-lg bg-transparent" onClick={() => handleSort("name")}>
                            <div className="flex items-center">
                              Application
                              {getSortIcon("name")}
                            </div>
                          </TableHead>
                          <TableHead className="w-[180px] cursor-pointer" onClick={() => handleSort("category")}>
                            <div className="flex items-center">
                              Category
                              {getSortIcon("category")}
                            </div>
                          </TableHead>
                          <TableHead className="text-center cursor-pointer" onClick={() => handleSort("userCount")}>
                            <div className="flex items-center justify-center">
                              Users
                              {getSortIcon("userCount")}
                            </div>
                          </TableHead>
                          <TableHead className="text-center cursor-pointer" onClick={() => handleSort("riskLevel")}>
                            <div className="flex items-center justify-center">
                              Risk
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
                          <TableHead className="cursor-pointer" onClick={() => handleSort("lastLogin")}>
                            <div className="flex items-center">
                              Last Login
                              {getSortIcon("lastLogin")}
                            </div>
                          </TableHead>
                          <TableHead className="cursor-pointer" onClick={() => handleSort("managementStatus")}>
                            <div className="flex items-center">
                              Status
                              {getSortIcon("managementStatus")}
                            </div>
                          </TableHead>
                          <TableHead className="text-center rounded-tr-lg">User Access</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {currentApps.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">
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
                                  <AppIcon name={app.name} />
                                  <div className="font-medium">{app.name}</div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <CategoryBadge category={app.category} />
                              </TableCell>
                              <TableCell className="text-center">
                                <div className="flex items-center justify-center">
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
                              </TableCell>
                              <TableCell className="text-center">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="flex items-center justify-center">
                                        <RiskBadge level={app.riskLevel} />
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="max-w-xs text-xs">{app.riskReason}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </TableCell>
                              <TableCell className="text-center">{app.totalPermissions}</TableCell>
                              <TableCell>
                                <div className="whitespace-pre-line">{formatDate(app.lastLogin)}</div>
                              </TableCell>
                              <TableCell>
                                <select
                                  className="w-full h-8 rounded-md border border-gray-200 bg-white px-2 text-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200"
                                  value={editedStatuses[app.id] || app.managementStatus}
                                  onChange={(e) => handleStatusChange(app.id, e.target.value)}
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
                                  className="w-full text-primary hover:text-primary hover:bg-primary/10 hover:border-primary/50 transition-all"
                                >
                                  <User className="h-4 w-4 mr-2" />
                                  Track Usage
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
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                    >
                      First
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
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
                            onClick={() => setCurrentPage(Number(page))}
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
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                    >
                      Next
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(totalPages)}
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
                <h3 className="text-lg font-medium text-gray-900">Application Distribution by Category</h3>
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
                            <span className="text-gray-900">
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
                <h3 className="text-lg font-medium text-gray-900">Top Apps by User Count</h3>
                <p className="text-sm text-gray-500 mb-4">Applications ranked by number of users</p>
                <div className="h-96">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={getTop10AppsByUsers()} layout="vertical" margin={{ left: 150 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
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
                        name="Users" 
                        radius={[0, 4, 4, 0]} 
                        barSize={20}
                        strokeWidth={1}
                        stroke="#fff"
                      >
                        {getTop10AppsByUsers().map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={entry.color} 
                            fillOpacity={1}
                          />
                        ))}
                      </Bar>
                      <RechartsTooltip
                        formatter={(value) => [`${value} users`, ""]}
                        contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', whiteSpace: 'nowrap' }}
                        labelStyle={{ color: '#111827', fontWeight: 500 }}
                        itemStyle={{ color: '#111827', fontWeight: 600 }}
                        cursor={{ fill: "rgba(0, 0, 0, 0.05)" }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Risk Level Distribution */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-lg font-medium text-gray-900">Risk Level Distribution</h3>
                <p className="text-sm text-gray-500 mb-4">Number of applications by risk level</p>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={getRiskChartData()} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#111827', fontSize: 12 }} />
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={80} tick={{ fill: '#111827', fontSize: 12 }} />
                      <Bar 
                        dataKey="value" 
                        name="Applications" 
                        radius={[0, 4, 4, 0]} 
                        barSize={30}
                        strokeWidth={1}
                        stroke="#fff"
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
                        contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', whiteSpace: 'nowrap' }}
                        labelStyle={{ color: '#111827', fontWeight: 500 }}
                        itemStyle={{ color: '#111827', fontWeight: 600 }}
                        cursor={{ fill: "rgba(0, 0, 0, 0.05)" }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Apps by Scope Permissions */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-lg font-medium text-gray-900">Top Apps by Scope Permissions</h3>
                <p className="text-sm text-gray-500 mb-4">Applications ranked by number of scope permissions</p>
                <div className="h-96">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={getTop10AppsByPermissions()} layout="vertical" margin={{ left: 150 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
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
                      >
                        {getTop10AppsByPermissions().map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={entry.color} 
                            fillOpacity={1}
                          />
                        ))}
                      </Bar>
                      <RechartsTooltip
                        formatter={(value) => [`${value} permissions`, ""]}
                        contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '6px', whiteSpace: 'nowrap' }}
                        labelStyle={{ color: '#111827', fontWeight: 500 }}
                        itemStyle={{ color: '#111827', fontWeight: 600 }}
                        cursor={{ fill: "rgba(0, 0, 0, 0.05)" }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        // User detail view
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
                      <span className="text-sm text-muted-foreground font-medium">Status:</span>
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
                      <dt className="text-muted-foreground font-medium">Last Login</dt>
                      <dd className="font-medium">{formatDate(selectedApp.lastLogin)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground font-medium">Owner</dt>
                      <dd className="font-medium">{selectedApp.ownerEmail || "Not assigned"}</dd>
                    </div>
                  </dl>
                </div>

                <Tabs defaultValue="users" className="mb-6">
                  <TabsList className="bg-gray-100 p-1">
                    <TabsTrigger value="users" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                      Users
                    </TabsTrigger>
                    <TabsTrigger value="scopes" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
                      Scopes
                    </TabsTrigger>
                    <TabsTrigger value="notes" className="data-[state=active]:bg-white data-[state=active]:shadow-sm">
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
                                className="cursor-pointer bg-transparent"
                                onClick={() => handleUserSort("lastActive")}
                              >
                                <div className="flex items-center">
                                  Last Login
                                  {getUserSortIcon("lastActive")}
                                </div>
                              </TableHead>
                              <TableHead className="bg-transparent">Scopes</TableHead>
                              <TableHead 
                                className="cursor-pointer rounded-tr-lg bg-transparent"
                                onClick={() => handleUserSort("riskLevel")}
                              >
                                <div className="flex items-center">
                                  Risk Level
                                  {getUserSortIcon("riskLevel")}
                                </div>
                              </TableHead>
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
                                  <TableCell>{formatDate(user.lastActive)}</TableCell>
                                  <TableCell>
                                    <div className="max-h-24 overflow-y-auto text-sm">
                                      {user.scopes.map((scope, i) => (
                                        <div key={i} className="py-1 border-b border-muted last:border-0">
                                          {scope}
                                        </div>
                                      ))}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div className="flex items-center gap-1">
                                            <RiskBadge level={user.riskLevel} />
                                            <Info className="h-4 w-4 text-muted-foreground" />
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p className="max-w-xs text-xs">{user.riskReason}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
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
                      <h3 className="text-lg font-medium mb-4">Scope Groups</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        Users are grouped by identical permission sets. Each group represents a unique set of
                        permissions.
                      </p>

                      {(() => {
                        const scopeGroups = getScopeGroups(selectedApp)
                        const totalScopePages = Math.ceil(scopeGroups.length / itemsPerPage)
                        const scopeStartIndex = (scopeCurrentPage - 1) * itemsPerPage
                        const scopeEndIndex = scopeStartIndex + itemsPerPage
                        const currentScopeGroups = scopeGroups.slice(scopeStartIndex, scopeEndIndex)

                        return (
                          <>
                            {currentScopeGroups.map((group, groupIndex) => (
                              <div key={groupIndex} className="mb-6 border rounded-md overflow-hidden">
                                <div className="bg-gray-50 p-3 flex justify-between items-center border-b border-gray-200">
                                  <h4 className="font-medium">
                                    Group {scopeStartIndex + groupIndex + 1} - {group.users.length}{" "}
                                    {group.users.length === 1 ? "user" : "users"}
                                  </h4>
                                  <Badge variant="outline" className="bg-primary/10">
                                    {group.scopes.length} {group.scopes.length === 1 ? "permission" : "permissions"}
                                  </Badge>
                                </div>

                                <div className="p-3 border-b">
                                  <h5 className="text-sm font-medium mb-2">Permissions:</h5>
                                  <div className="max-h-60 overflow-y-auto">
                                    {group.scopes.map((scope, scopeIndex) => (
                                      <div key={scopeIndex} className="py-1 border-b border-muted last:border-0 text-sm">
                                        {scope}
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                <div className="p-3">
                                  <h5 className="text-sm font-medium mb-2">Users in this group:</h5>
                                  <div className="flex flex-wrap gap-2">
                                    {group.users.map((user, userIndex) => (
                                      <div
                                        key={userIndex}
                                        className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-md border border-gray-200"
                                      >
                                        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-gray-200 text-xs font-medium text-gray-800">
                                          {user.name
                                            .split(" ")
                                            .map((n) => n[0])
                                            .join("")}
                                        </div>
                                        <span className="text-sm">{user.name}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            ))}

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
                            defaultValue={selectedApp.ownerEmail || ""}
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
                            defaultValue={selectedApp.notes || ""}
                          />
                        </div>
                        <Button>Save Changes</Button>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </div>
        </div>
      )}

      {/* Settings Dialog */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold">Settings</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsSettingsOpen(false)}
                className="hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="space-y-6">
              <h3 className="text-base font-medium text-gray-900">Customize your email notification preferences</h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-medium">New App Detection</Label>
                    <p className="text-sm text-gray-500">Get notified when a new app is detected</p>
                  </div>
                  <div className="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 cursor-pointer"
                       onClick={() => handleSettingChange('newAppDetected', !notificationSettings.newAppDetected)}
                       style={{ backgroundColor: notificationSettings.newAppDetected ? '#111827' : '#E5E7EB' }}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationSettings.newAppDetected ? 'translate-x-6' : 'translate-x-1'}`} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="font-medium">User Limit Threshold</Label>
                  <p className="text-sm text-gray-500">Get notified when an app exceeds this many users</p>
                  <Input
                    type="number"
                    value={notificationSettings.userLimitThreshold}
                    onChange={(e) => handleSettingChange('userLimitThreshold', e.target.value)}
                    className="w-full"
                    min="1"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-medium">Needs Review Apps</Label>
                    <p className="text-sm text-gray-500">Alert when new users are added to apps needing review</p>
                  </div>
                  <div className="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 cursor-pointer"
                       onClick={() => handleSettingChange('newUserInReviewApp', !notificationSettings.newUserInReviewApp)}
                       style={{ backgroundColor: notificationSettings.newUserInReviewApp ? '#111827' : '#E5E7EB' }}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationSettings.newUserInReviewApp ? 'translate-x-6' : 'translate-x-1'}`} />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-medium">New User Detection</Label>
                    <p className="text-sm text-gray-500">Alert when any new user is added to any app</p>
                  </div>
                  <div className="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 cursor-pointer"
                       onClick={() => handleSettingChange('newUserInAnyApp', !notificationSettings.newUserInAnyApp)}
                       style={{ backgroundColor: notificationSettings.newUserInAnyApp ? '#111827' : '#E5E7EB' }}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationSettings.newUserInAnyApp ? 'translate-x-6' : 'translate-x-1'}`} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="font-medium">Periodic Review</Label>
                  <p className="text-sm text-gray-500">Schedule regular reviews of all applications</p>
                  <select
                    value={notificationSettings.periodicReview}
                    onChange={(e) => handleSettingChange('periodicReview', e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-200"
                  >
                    <option value="1">Every Month</option>
                    <option value="2">Every 2 Months</option>
                    <option value="3">Every 3 Months</option>
                    <option value="6">Every 6 Months</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-6 border-t">
                <Button variant="outline" onClick={() => setIsSettingsOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setIsSettingsOpen(false)}>
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

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

