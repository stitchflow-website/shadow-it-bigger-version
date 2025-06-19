import Papa from "papaparse"
import { Application, AppUser } from "@/types"
import { determineRiskLevel } from "@/lib/risk-assessment"

export const fetchData = async (): Promise<Application[]> => {
  try {
    console.log("Starting data fetch...")
    const appsPromise = fetch("/applications.csv").then(res => res.text())
    const usersPromise = fetch("/users.csv").then(res => res.text())
    const userAppsPromise = fetch("/applications_data.csv").then(res => res.text())
    const aiScoringPromise = fetch("/Adam_revised_latest_app.csv").then(res => res.text())

    const [appsCsv, usersCsv, userAppsCsv, aiScoringCsv] = await Promise.all([appsPromise, usersPromise, userAppsPromise, aiScoringPromise])
    console.log("CSV files loaded - apps length:", appsCsv.length, "users length:", usersCsv.length, "userApps length:", userAppsCsv.length, "aiScoring length:", aiScoringCsv.length)

    const appsResult = Papa.parse(appsCsv, { header: true, skipEmptyLines: true })
    const usersResult = Papa.parse(usersCsv, { header: true, skipEmptyLines: true })
    const userAppsResult = Papa.parse(userAppsCsv, { header: true, skipEmptyLines: true })
    const aiScoringResult = Papa.parse(aiScoringCsv, { header: true, skipEmptyLines: true })

    const applicationsData: any[] = appsResult.data
    const usersData: any[] = usersResult.data
    const userAppsData: any[] = userAppsResult.data
    const aiScoringData: any[] = aiScoringResult.data

    console.log("Parsed data - apps:", applicationsData.length, "users:", usersData.length, "userApps:", userAppsData.length, "aiScoring:", aiScoringData.length)
    console.log("Sample app:", applicationsData[0])
    console.log("Sample user:", usersData[0])
    console.log("Sample userApp:", userAppsData[0])
    console.log("Sample aiScoring:", aiScoringData[0])

    const getAppUsers = (appId: string): AppUser[] => {
      return userAppsData
        .filter((ua: any) => ua.application_id === appId)
        .map((ua: any) => {
          const user = usersData.find((u: any) => u.id === ua.user_id)
          let scopes: string[] = []
          if (typeof ua.scopes === "string") {
            try {
              scopes = JSON.parse(ua.scopes)
            } catch (e) {
              scopes = (ua.scopes || "")
                .replace(/^{|}$/g, "")
                .split`,`
                .map((s: string) => s.trim().replace(/^"|"$/g, ""))
            }
          }

          return {
            id: ua.user_id,
            appId: ua.application_id,
            name: user ? user.name : "Unknown User",
            email: user ? user.email : "unknown@acme.com",
            lastActive: ua.last_used,
            created_at: ua.created_at,
            scopes: scopes,
            riskLevel: determineRiskLevel(scopes),
            riskReason: "No reason specified", // Placeholder
          }
        })
    }

    const processedApplications: Application[] = applicationsData.map(
      (app: any): Application => {
        const appUsers = getAppUsers(app.id)
        const allScopes = appUsers.flatMap(u => u.scopes)
        const uniqueScopes = [...new Set(allScopes)]

        // Find matching AI scoring data by app name
        const aiData = aiScoringData.find((ai: any) => 
          ai["Tool Name"]?.toLowerCase().trim() === app.name?.toLowerCase().trim()
        )

        return {
          id: app.id,
          name: app.name,
          category: app.category || "Uncategorized",
          userCount: appUsers.length,
          users: appUsers,
          riskLevel: determineRiskLevel(uniqueScopes),
          riskReason: "No reason specified", // Placeholder
          totalPermissions: uniqueScopes.length,
          scopeVariance: { userGroups: 0, scopeGroups: 0 }, // Placeholder
          logoUrl: app.image_url,
          managementStatus: "Unmanaged", // Placeholder
          ownerEmail: "owner@acme.com", // Placeholder
          notes: "", // Placeholder
          scopes: uniqueScopes,
          isInstalled: true, // Placeholder
          isAuthAnonymously: false, // Placeholder
          aiScoringData: aiData || null, // Add AI scoring data
        }
      },
    )

    return processedApplications
  } catch (error) {
    console.error("Failed to fetch or parse data:", error)
    return []
  }
}

// Export the AI scoring data separately for organization settings
export const fetchAIScoringData = async (): Promise<any[]> => {
  try {
    const response = await fetch("/Adam_revised_latest_app.csv")
    const csvText = await response.text()
    const result = Papa.parse(csvText, { header: true, skipEmptyLines: true })
    return result.data as any[]
  } catch (error) {
    console.error("Failed to fetch AI scoring data:", error)
    return []
  }
} 