import { type RiskLevel } from "@/lib/risk-assessment"

// Type definitions
export type Application = {
  id: string
  name: string
  category: string | null // Modified to allow null
  userCount: number
  users: AppUser[]
  riskLevel: RiskLevel
  riskReason: string
  totalPermissions: number
  scopeVariance: { userGroups: number; scopeGroups: number }
  logoUrl?: string // Primary logo URL
  logoUrlFallback?: string // Fallback logo URL
  created_at?: string // Added created_at field
  managementStatus: "Managed" | "Unmanaged" | "Needs Review"
  ownerEmail: string
  notes: string
  scopes: string[]
  isInstalled: boolean
  isAuthAnonymously: boolean
  isCategorizing?: boolean // Added to track categorization status
  aiScoringData?: any // AI scoring data from Adam_revised_latest_app.csv
}

export type AppUser = {
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
export type SortColumn =
  | "name"
  | "category"
  | "userCount"
  | "riskLevel"
  | "totalPermissions"
  // | "lastLogin" // Removed
  | "managementStatus"
  | "highRiskUserCount" // Added for the new column
  | "aiRiskScore" // Added for AI Risk Score column
export type SortDirection = "asc" | "desc"

// User table sort types
export type UserSortColumn = "name" | "email" | "created" | "riskLevel"

// Chart data types
export type CategoryData = {
  name: string
  value: number
  color: string
}

export type BarChartData = {
  name: string
  users: number
  apps: number
}

export type RiskData = {
  name: string
  value: number
  color: string
} 