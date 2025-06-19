"use client"

import React, { useState, useCallback, useMemo } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { ArrowUpDown, ArrowUp, ArrowDown, CheckCircle, AlertTriangle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface AIRiskData {
  appName: string
  category: string
  scopeRisk: string
  users: number
  rawAppRiskScore: number
  finalAppRiskScore: number
  blastRadius: number
}

interface OrgSettings {
  bucketWeights: {
    dataPrivacy: number;
    securityAccess: number;
    businessImpact: number;
    aiGovernance: number;
    vendorProfile: number;
  };
  aiMultipliers: {
    native: Record<string, number>;
    partial: Record<string, number>;
    none: Record<string, number>;
  };
  scopeMultipliers: {
    high: Record<string, number>;
    medium: Record<string, number>;
    low: Record<string, number>;
  };
}

interface AIRiskAnalysisTableProps {
  data: AIRiskData[]
  highlightTopRows?: number
  highlightColor?: string
  className?: string
  orgSettings: OrgSettings
}

export function AIRiskAnalysisTable({
  data,
  highlightTopRows = 5,
  className = "",
  orgSettings
}: AIRiskAnalysisTableProps) {
  const [sortKey, setSortKey] = useState<keyof AIRiskData>("blastRadius")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortKey || data.length === 0) return data

    return [...data].sort((a, b) => {
      const valueA = a[sortKey]
      const valueB = b[sortKey]
      
      // Handle numeric comparison
      if (typeof valueA === 'number' && typeof valueB === 'number') {
        return sortDirection === "asc" ? valueA - valueB : valueB - valueA
      }
      
      // String comparison
      const stringA = String(valueA).toLowerCase()
      const stringB = String(valueB).toLowerCase()
      
      if (sortDirection === "asc") {
        return stringA.localeCompare(stringB)
      } else {
        return stringB.localeCompare(stringA)
      }
    })
  }, [data, sortKey, sortDirection])

  // Handle sorting
  const handleSort = (key: keyof AIRiskData) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDirection("desc")
    }
  }

  // Get sort icon
  const getSortIcon = (key: keyof AIRiskData) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="ml-1 h-4 w-4 opacity-50" />
    }
    return sortDirection === "asc" ? <ArrowUp className="ml-1 h-4 w-4" /> : <ArrowDown className="ml-1 h-4 w-4" />
  }

  // Render sortable header
  const getSortableHeader = (label: string, key: keyof AIRiskData, className: string = "") => {
    return (
      <TableHead 
        className={`cursor-pointer bg-transparent ${className}`}
        onClick={() => handleSort(key)}
      >
        <div className="flex items-center">
          {label}
          {getSortIcon(key)}
        </div>
      </TableHead>
    )
  }

  // Format cell value for display
  const formatCellValue = (value: any, type: 'number' | 'string' = 'string'): string => {
    if (type === 'number' && typeof value === 'number') {
      return value % 1 === 0 ? value.toString() : value.toFixed(1)
    }
    return String(value)
  }

  // Category Badge Component (matching project patterns)
  const CategoryBadge = ({ category }: { category: string }) => {
    const getCategoryBadgeColor = (category: string) => {
      if (category.toLowerCase().includes('native')) {
        return 'bg-red-100 text-red-600'
      } else if (category.toLowerCase().includes('partial')) {
        return 'bg-yellow-100 text-yellow-600'
      }
      return 'bg-gray-100 text-gray-600'
    }

    const truncateText = (text: string, maxLength: number = 15) => {
      if (text.length > maxLength) {
        return text.substring(0, maxLength) + "..."
      }
      return text
    }

    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getCategoryBadgeColor(category)} overflow-hidden text-ellipsis whitespace-nowrap max-w-[120px]`}
            >
              {truncateText(category, 15)}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="p-2 bg-gray-900 text-white rounded-md shadow-lg">
            <p className="text-xs">{category}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Risk Badge Component (matching project patterns)
  const RiskBadge = ({ level }: { level: string }) => {
    const normalizedLevel = level.charAt(0).toUpperCase() + level.slice(1).toLowerCase()
    
    const iconMap: Record<string, React.JSX.Element> = {
      Low: <CheckCircle className="h-4 w-4 mr-1 text-green-700" />,
      Medium: <AlertTriangle className="h-4 w-4 mr-1 text-yellow-700" />,
      High: <AlertTriangle className="h-4 w-4 mr-1 text-pink-700" />
    }

    const colorMap: Record<string, string> = {
      Low: "text-green-700 bg-green-50",
      Medium: "text-yellow-700 bg-yellow-50",
      High: "text-pink-700 bg-pink-50"
    }

    return (
      <div className={`flex items-center px-2 py-1 rounded-full text-xs font-medium ${colorMap[normalizedLevel] || colorMap.Low}`}>
        {iconMap[normalizedLevel] || iconMap.Low}
        <span>{normalizedLevel}</span>
      </div>
    )
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header section matching project patterns */}
      <div className="flex justify-between items-center mt-[-4px]">
        <div>
          <p className="text-lg font-medium text-gray-800">
            AI Risk Analysis Results - {data.length} applications analyzed
          </p>
        </div>
      </div>

      {/* Main card container matching project patterns */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-6">
          {/* Sort info section */}
          <div className="mb-4">
            <Label className="text-sm font-medium text-gray-700">
              Sorted by {sortKey === 'blastRadius' ? 'Blast Radius' : 
                        sortKey === 'appName' ? 'App Name' :
                        sortKey === 'scopeRisk' ? 'Scope Risk' :
                        sortKey === 'rawAppRiskScore' ? 'Raw App Risk Score' :
                        sortKey === 'finalAppRiskScore' ? 'Final App Risk Score' :
                        sortKey === 'users' ? 'Users' :
                        sortKey === 'category' ? 'Category' : sortKey} 
              ({sortDirection === 'asc' ? 'ascending' : 'descending'})
            </Label>
          </div>

          {/* Highlight legend */}
          {highlightTopRows > 0 && data.length > 0 && (
            <div className="flex items-center py-3 px-4 bg-gray-50 rounded-lg border border-gray-200 mb-6">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full border border-gray-300 bg-[#F7F5F2]"></div>
                <span className="text-sm text-gray-600">
                  Top {highlightTopRows} apps highlighted
                </span>
              </div>
            </div>
          )}

          {/* Table container matching project patterns */}
          <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              {data.length > 0 ? (
                <Table className="w-full min-w-fit">
                  <TableHeader className="sticky top-0 bg-gray-50/80 backdrop-blur-sm z-10">
                    <TableRow className="border-b border-gray-100">
                      {getSortableHeader("Application", "appName", "rounded-tl-lg")}
                      {getSortableHeader("Category", "category")}
                      {getSortableHeader("Scope Risk", "scopeRisk", "text-center")}
                      {getSortableHeader("Users", "users", "text-center")}
                      {getSortableHeader("Raw App Risk Score", "rawAppRiskScore", "text-center")}
                      {getSortableHeader("Final App Risk Score", "finalAppRiskScore", "text-center")}
                      {getSortableHeader("Blast Radius", "blastRadius", "text-center rounded-tr-lg font-semibold")}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedData.map((row, index) => (
                      <TableRow
                        key={index}
                        className={`${index % 2 === 0 ? "bg-muted/10" : ""} ${
                          index === sortedData.length - 1 ? "last-row" : ""
                        } ${highlightTopRows > 0 && index < highlightTopRows ? "bg-[#F7F5F2]" : ""}`}
                      >
                        {/* App Name */}
                        <TableCell>
                          <TooltipProvider>
                            <Tooltip delayDuration={300}>
                              <TooltipTrigger asChild>
                                <div className="font-medium cursor-pointer hover:text-primary transition-colors truncate max-w-[120px]">
                                  {row.appName.length > 15 ? row.appName.substring(0, 15) + "..." : row.appName}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="p-2">
                                <p className="text-sm">{row.appName}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        
                        {/* Category */}
                        <TableCell>
                          <CategoryBadge category={row.category} />
                        </TableCell>
                        
                        {/* Scope Risk */}
                        <TableCell>
                          <TooltipProvider>
                            <Tooltip delayDuration={300}>
                              <TooltipTrigger asChild>
                                <div className="flex items-center justify-center">
                                  <RiskBadge level={row.scopeRisk} />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="p-2">
                                <p className="text-sm">Scope Risk Level: {row.scopeRisk}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        
                        {/* Users */}
                        <TableCell className="text-center">
                          <div className="font-medium text-gray-900">
                            {formatCellValue(row.users, 'number')}
                          </div>
                        </TableCell>
                        
                        {/* Raw App Risk Score */}
                        <TableCell className="text-center">
                          <TooltipProvider>
                            <Tooltip delayDuration={300}>
                              <TooltipTrigger asChild>
                                <div className="font-medium text-gray-900 cursor-pointer">
                                  {formatCellValue(row.rawAppRiskScore, 'number')}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="p-2">
                                <p className="text-sm">Base risk score before amplification factors</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        
                        {/* Final App Risk Score */}
                        <TableCell className="text-center">
                          <TooltipProvider>
                            <Tooltip delayDuration={300}>
                              <TooltipTrigger asChild>
                                <div className="font-medium text-gray-900 cursor-pointer">
                                  {formatCellValue(row.finalAppRiskScore, 'number')}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="p-2">
                                <p className="text-sm">Final score after AI and scope multipliers</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                        
                        {/* Blast Radius */}
                        <TableCell className="text-center">
                          <TooltipProvider>
                            <Tooltip delayDuration={300}>
                              <TooltipTrigger asChild>
                                <div className="font-normal text-gray-900 cursor-pointer">
                                  {formatCellValue(row.blastRadius, 'number')}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="p-2">
                                <p className="text-sm">
                                  Organizational impact: {row.users} users × {row.finalAppRiskScore.toFixed(1)} final score
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No AI Risk Data Available</h3>
                  <p className="text-gray-500">AI risk analysis data will appear here once applications are processed</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 