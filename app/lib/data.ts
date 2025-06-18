import Papa from "papaparse"
import { Application, AppUser } from "@/types"
import { determineRiskLevel } from "@/lib/risk-assessment"

export const fetchData = async (): Promise<Application[]> => {
  try {
    const appsPromise = fetch("/applications.csv").then(res => res.text())
    const usersPromise = fetch("/users.csv").then(res => res.text())
    const userAppsPromise = fetch("/applications_data.csv").then(res => res.text())

    const [appsCsv, usersCsv, userAppsCsv] = await Promise.all([appsPromise, usersPromise, userAppsPromise])

    const appsResult = Papa.parse(appsCsv, { header: true, skipEmptyLines: true })
    const usersResult = Papa.parse(usersCsv, { header: true, skipEmptyLines: true })
    const userAppsResult = Papa.parse(userAppsCsv, { header: true, skipEmptyLines: true })

    const applicationsData: any[] = appsResult.data
    const usersData: any[] = usersResult.data
    const userAppsData: any[] = userAppsResult.data

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
            email: user ? user.email : "unknown@example.com",
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
          ownerEmail: "owner@example.com", // Placeholder
          notes: "", // Placeholder
          scopes: uniqueScopes,
          isInstalled: true, // Placeholder
          isAuthAnonymously: false, // Placeholder
        }
      },
    )

    return processedApplications
  } catch (error) {
    console.error("Failed to fetch or parse data:", error)
    return []
  }
} 