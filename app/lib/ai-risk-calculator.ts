import { transformRiskLevel } from '@/lib/risk-assessment';
import type { Application } from '@/types';

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

interface ScoringCriteria {
  [key: string]: {
    name: string;
    weight: number;
    criteria: any[];
    averageField: string;
  };
}

export function calculateFinalAIRiskScore(
  app: Application,
  allAIScoringData: any[],
  orgSettings: OrgSettings
): number | null {
  // Fuzzy matching function (same as in generateAIRiskAnalysisData)
  const findAIScoringData = (appName: string) => {
    const cleanAppName = appName.trim().toLowerCase();
    
    // First try exact match (case insensitive)
    let exactMatch = allAIScoringData.find(ai => 
      ai["Tool Name"]?.toLowerCase().trim() === cleanAppName
    );
    if (exactMatch) return exactMatch;
    
    // Try fuzzy matching
    for (const aiData of allAIScoringData) {
      const aiName = aiData["Tool Name"]?.toLowerCase().trim() || "";
      
      // Skip if either name is too short
      if (cleanAppName.length <= 3 || aiName.length <= 3) continue;
      
      // Check if one name contains the other
      if (cleanAppName.includes(aiName) || aiName.includes(cleanAppName)) {
        return aiData;
      }
      
      // Check similarity score using a simple string similarity function
      const similarity = calculateStringSimilarity(cleanAppName, aiName);
      if (similarity > 0.8) {
        return aiData;
      }
    }
    
    return null; // No match found
  };
  
  // Simple string similarity function (Jaccard similarity on words)
  const calculateStringSimilarity = (str1: string, str2: string): number => {
    const words1 = new Set(str1.split(/\s+/));
    const words2 = new Set(str2.split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    if (union.size === 0) return 0;
    return intersection.size / union.size;
  };

  // Use fuzzy matching to find AI scoring data
  const aiData = findAIScoringData(app.name);
  if (!aiData) {
    return null;
  }

  // Define scoring criteria (same as in RiskScoringTab)
  const scoringCriteria: ScoringCriteria = {
    dataPrivacy: {
      name: "Data Privacy & Handling",
      weight: orgSettings.bucketWeights.dataPrivacy,
      criteria: [],
      averageField: "Average 1"
    },
    securityAccess: {
      name: "Security & Access Controls",
      weight: orgSettings.bucketWeights.securityAccess,
      criteria: [],
      averageField: "Average 2"
    },
    businessImpact: {
      name: "Business Impact & Criticality",
      weight: orgSettings.bucketWeights.businessImpact,
      criteria: [],
      averageField: "Average 3"
    },
    aiGovernance: {
      name: "AI Governance & Transparency",
      weight: orgSettings.bucketWeights.aiGovernance,
      criteria: [],
      averageField: "Average 4"
    },
    vendorProfile: {
      name: "Vendor Profile & Reliability",
      weight: orgSettings.bucketWeights.vendorProfile,
      criteria: [],
      averageField: "Average 5"
    }
  };

  // Get AI status
  const aiStatus = aiData?.["Gen AI-Native"]?.toLowerCase() || "";
  
  // Get scope risk from the actual app data (not hardcoded)
  const getCurrentScopeRisk = () => {
    if (app && app.riskLevel) {
      const riskLevel = transformRiskLevel(app.riskLevel);
      return riskLevel.toUpperCase();
    }
    return 'MEDIUM';
  };
  
  const currentScopeRisk = getCurrentScopeRisk();
  
  // Get scope multipliers
  const getScopeMultipliers = (scopeRisk: string) => {
    if (scopeRisk === 'HIGH') return orgSettings.scopeMultipliers.high;
    if (scopeRisk === 'MEDIUM') return orgSettings.scopeMultipliers.medium;
    return orgSettings.scopeMultipliers.low;
  };

  const scopeMultipliers = getScopeMultipliers(currentScopeRisk);
  
  // Get AI multipliers
  const getAIMultipliers = (status: string) => {
    const lowerStatus = status.toLowerCase().trim();
    if (lowerStatus.includes("partial")) return orgSettings.aiMultipliers.partial;
    if (lowerStatus.includes("no") || lowerStatus === "" || lowerStatus.includes("not applicable")) return orgSettings.aiMultipliers.none;
    if (lowerStatus.includes("genai") || lowerStatus.includes("native") || lowerStatus.includes("yes")) return orgSettings.aiMultipliers.native;
    return orgSettings.aiMultipliers.none;
  };

  const multipliers = getAIMultipliers(aiStatus);
  
  // Calculate base score
  const calculateBaseScore = () => {
    return Object.values(scoringCriteria).reduce((total, category) => {
      const numScore = aiData?.[category.averageField] ? Number.parseFloat(aiData[category.averageField]) : 0;
      return total + (numScore * (category.weight / 100) * 2);
    }, 0);
  };

  // Calculate AI score
  const calculateAIScore = () => {
    return Object.entries(scoringCriteria).reduce((total, [key, category]) => {
      const numScore = aiData?.[category.averageField] ? Number.parseFloat(aiData[category.averageField]) : 0;
      const weightedScore = numScore * (category.weight / 100) * 2;
      const aiMultiplier = multipliers[key as keyof typeof multipliers] as number;
      return total + (weightedScore * aiMultiplier);
    }, 0);
  };
  
  // Calculate scope score
  const calculateScopeScore = () => {
    return Object.entries(scoringCriteria).reduce((total, [key, category]) => {
      const numScore = aiData?.[category.averageField] ? Number.parseFloat(aiData[category.averageField]) : 0;
      const weightedScore = numScore * (category.weight / 100) * 2;
      const aiMultiplier = multipliers[key as keyof typeof multipliers] as number;
      const scopeMultiplier = scopeMultipliers[key as keyof typeof scopeMultipliers] as number;
      return total + (weightedScore * aiMultiplier * scopeMultiplier);
    }, 0);
  };
  
  const baseScore = calculateBaseScore();
  const aiScore = calculateAIScore();
  const scopeScore = calculateScopeScore();
  const genAIAmplification = baseScore > 0 ? aiScore / baseScore : 1.0;
  const scopeAmplification = aiScore > 0 ? scopeScore / aiScore : 1.0;
  const totalAppRiskScore = baseScore * genAIAmplification * scopeAmplification;
  
  return totalAppRiskScore;
} 