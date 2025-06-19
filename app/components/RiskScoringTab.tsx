import React, { useMemo } from 'react';
import { transformRiskLevel } from '@/lib/risk-assessment';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// --- TYPE DEFINITIONS ---

interface App {
  [key: string]: string;
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

interface RiskScoringTabProps {
  app: App | null;
  allApps: App[];
  orgSettings: OrgSettings;
  selectedAppData?: any; // Add the full application data for real risk level
}

// Scoring rubric data
const riskScoringRubric: Record<string, any> = {
  dataPrivacy: {
    name: "Data Privacy & Handling",
    criteria: [
      {
        name: "Data Sensitivity",
        definitions: [
          { score: 1, level: "Very Low", description: "No sensitive data processed; only public information; clear data minimization practices" },
          { score: 2, level: "Low", description: "Limited sensitive data; strong retention policies; comprehensive deletion options" },
          { score: 3, level: "Medium", description: "Moderate sensitive data exposure; adequate retention policies; some deletion options" },
          { score: 4, level: "High", description: "Significant data exposure; vague retention policies; limited deletion options" },
          { score: 5, level: "Very High", description: "Extensive sensitive/PII data; unclear retention; no deletion options; potential for data misuse" }
        ]
      },
      {
        name: "Data Residency",
        definitions: [
          { score: 1, level: "Very Low", description: "Data stored in preferred regions; full control over location; comprehensive documentation" },
          { score: 2, level: "Low", description: "Data in acceptable regions; good location controls; clear documentation" },
          { score: 3, level: "Medium", description: "Limited regional options but clear documentation on data location" },
          { score: 4, level: "High", description: "Data stored in concerning regions; limited location visibility; unclear documentation" },
          { score: 5, level: "Very High", description: "Data in prohibited regions; no location control; no documentation on data residency" }
        ]
      },
      {
        name: "Training Data Usage",
        definitions: [
          { score: 1, level: "Very Low", description: "Explicit opt-out from training; clear data usage policies; customer data never used for training" },
          { score: 2, level: "Low", description: "Clear policies against using customer data for training; good transparency" },
          { score: 3, level: "Medium", description: "Some clarity on training data usage; limited customer data use" },
          { score: 4, level: "High", description: "Unclear policies on customer data usage for training" },
          { score: 5, level: "Very High", description: "Customer data explicitly used for training; no opt-out options; unclear usage scope" }
        ]
      },
      {
        name: "Policy Transparency",
        definitions: [
          { score: 1, level: "Very Low", description: "Comprehensive, clear policies; detailed privacy documentation; regular updates communicated" },
          { score: 2, level: "Low", description: "Clear policies with good detail; accessible documentation; regular updates" },
          { score: 3, level: "Medium", description: "Policies available but lack detail/clarity" },
          { score: 4, level: "High", description: "Vague policies; limited documentation; unclear terms and conditions" },
          { score: 5, level: "Very High", description: "No clear policies; missing documentation; frequently changing terms without notice" }
        ]
      }
    ]
  }
  // Additional categories would be added here...
};

function getScoreDefinition(category: string, criteria: string, score: number): any {
  const categoryRubric = riskScoringRubric[category];
  if (!categoryRubric) return null;

  const criteriaRubric = categoryRubric.criteria.find((c: any) => c.name === criteria);
  if (!criteriaRubric) return null;

  const definition = criteriaRubric.definitions.find((d: any) => d.score === score);
  return definition || null;
}

// --- MAIN COMPONENT ---

export const RiskScoringTab: React.FC<RiskScoringTabProps> = ({ app, allApps, orgSettings, selectedAppData }) => {
  
  // Memoize scoring criteria to ensure it only updates when orgSettings change
  const scoringCriteria = useMemo(() => ({
    dataPrivacy: {
      name: "Data Privacy & Handling",
      weight: orgSettings.bucketWeights.dataPrivacy,
      criteria: [
        { field: "Data Sensitivity & Processing", rubricKey: "Data Sensitivity" },
        { field: "Data Residency & Control", rubricKey: "Data Residency" },
        { field: "Training Data Usage", rubricKey: "Training Data Usage" },
        { field: "Policy Transparency", rubricKey: "Policy Transparency" },
      ],
      averageField: "Average 1"
    },
    securityAccess: {
      name: "Security & Access Controls",
      weight: orgSettings.bucketWeights.securityAccess,
      criteria: [
        { field: "Security Certification", rubricKey: "Security Certifications" },
        { field: "Vulnerability Management", rubricKey: "Vulnerability Management" },
        { field: "Authentication & Access Controls", rubricKey: "Authentication & Access" },
        { field: "Breach History", rubricKey: "Breach History" },
      ],
      averageField: "Average 2"
    },
    businessImpact: {
      name: "Business Impact & Criticality",
      weight: orgSettings.bucketWeights.businessImpact,
      criteria: [
        { field: "Operational Importance", rubricKey: "Operational Importance" },
        { field: "Data Criticality", rubricKey: "Data Criticality" },
        { field: "User Base & Scope", rubricKey: "User Base & Scope" },
      ],
      averageField: "Average 3"
    },
    aiGovernance: {
      name: "AI Governance & Transparency",
      weight: orgSettings.bucketWeights.aiGovernance,
      criteria: [
        { field: "Model Transparency", rubricKey: "Model Transparency" },
        { field: "Human Oversight", rubricKey: "Human Oversight" },
        { field: "Model Provenance & Type", rubricKey: "Model Provenance" },
        { field: "User Opt-Out Options", rubricKey: "User Opt-Out Options" },
      ],
      averageField: "Average 4"
    },
    vendorProfile: {
      name: "Vendor Profile & Reliability",
      weight: orgSettings.bucketWeights.vendorProfile,
      criteria: [
        { field: "Company Stability", rubricKey: "Company Stability" },
        { field: "Support & Documentation", rubricKey: "Support & Documentation" },
        { field: "Integration Complexity", rubricKey: "Integration Complexity" },
      ],
      averageField: "Average 5"
    }
  }), [orgSettings.bucketWeights]);

  // All scoring calculations are memoized to re-run only when dependencies change
  const scoringCalculations = useMemo(() => {
    if (!app) return null;
    
    const finalScore = app?.["Final Risk Score - Aggregated"];
    const aiStatus = app?.["Gen AI-Native"]?.toLowerCase() || "";
    
    // Get the actual scope risk from the selected app's real risk level calculation
    const getCurrentScopeRisk = () => {
      if (selectedAppData && selectedAppData.riskLevel) {
        // Transform to uppercase for consistency with existing logic
        const riskLevel = transformRiskLevel(selectedAppData.riskLevel);
        return riskLevel.toUpperCase();
      }
      // Fallback to MEDIUM if no risk level available
      return 'MEDIUM';
    };
    
    const currentScopeRisk = getCurrentScopeRisk();
    
    const getScopeMultipliers = (scopeRisk: string) => {
      if (scopeRisk === 'HIGH') return orgSettings.scopeMultipliers.high;
      if (scopeRisk === 'MEDIUM') return orgSettings.scopeMultipliers.medium;
      return orgSettings.scopeMultipliers.low;
    };

    const scopeMultipliers = getScopeMultipliers(currentScopeRisk);
    
    const getAIMultipliers = (status: string) => {
      const lowerStatus = status.toLowerCase().trim();
      if (lowerStatus.includes("partial")) return orgSettings.aiMultipliers.partial;
      if (lowerStatus.includes("no") || lowerStatus === "" || lowerStatus.includes("not applicable")) return orgSettings.aiMultipliers.none;
      if (lowerStatus.includes("genai") || lowerStatus.includes("native") || lowerStatus.includes("yes")) return orgSettings.aiMultipliers.native;
      return orgSettings.aiMultipliers.none;
    };

    const multipliers = getAIMultipliers(aiStatus);
    
    const calculateBaseScore = () => {
      return Object.values(scoringCriteria).reduce((total, category) => {
        const numScore = app?.[category.averageField] ? Number.parseFloat(app[category.averageField]) : 0;
        return total + (numScore * (category.weight / 100) * 2);
      }, 0);
    };

    const calculateAIScore = () => {
      return Object.entries(scoringCriteria).reduce((total, [key, category]) => {
        const numScore = app?.[category.averageField] ? Number.parseFloat(app[category.averageField]) : 0;
        const weightedScore = numScore * (category.weight / 100) * 2;
        const aiMultiplier = multipliers[key as keyof typeof multipliers] as number;
        return total + (weightedScore * aiMultiplier);
      }, 0);
    };
    
    const calculateScopeScore = () => {
      return Object.entries(scoringCriteria).reduce((total, [key, category]) => {
        const numScore = app?.[category.averageField] ? Number.parseFloat(app[category.averageField]) : 0;
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
    
    return {
      finalScore, aiStatus, currentScopeRisk, scopeMultipliers, multipliers,
      baseScore, aiScore, scopeScore, genAIAmplification, scopeAmplification, totalAppRiskScore
    };
  }, [app, allApps, orgSettings, scoringCriteria]);

  if (!app) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg border border-gray-200">
        <div className="text-center">
          <div className="text-gray-400 mb-3">
            <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">AI Risk Analysis Not Available</h3>
          <p className="text-gray-500 text-sm">AI risk analysis not available for this app</p>
        </div>
      </div>
    );
  }

  if (!scoringCalculations) {
    return <div>Loading scoring data...</div>;
  }
    
  const {
    finalScore, aiStatus, currentScopeRisk, scopeMultipliers, multipliers,
    baseScore, aiScore, scopeScore, genAIAmplification, scopeAmplification, totalAppRiskScore
  } = scoringCalculations;
    
  const appsWithoutScopeRisk = [ '3CX', 'Aha!', 'Atlassian Cloud', 'Employment Hero', 'Employment Law Practical Handbook', 'Keeper Password Manager', 'Monday OneDrive', 'MyFiles (Entra)', 'Salesforce', 'Shop.app' ];
  const hasScopeRisk = !appsWithoutScopeRisk.includes(app["Tool Name"] || "");
    
  return (
    <div className="space-y-8">
      {/* Total App Risk Score Section */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Total App Risk Score</h3>
            <p className="text-sm text-gray-500">Comprehensive risk assessment incorporating base score, AI impact, and scope effects</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <Badge variant="outline" className="text-2xl px-6 py-3 border-gray-400 bg-gray-50 text-gray-900 font-bold">
              {totalAppRiskScore.toFixed(1)}
            </Badge>
          </div>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
            <div className="font-medium text-gray-900 text-sm">Total Risk Calculation</div>
            <div className="text-xs text-gray-600">
              {hasScopeRisk ? (
                <>Base Score ({baseScore.toFixed(1)}) × GenAI Amplification ({genAIAmplification.toFixed(1)}x) × Scope Amplification ({scopeAmplification.toFixed(1)}x) = {totalAppRiskScore.toFixed(1)}</>
              ) : (
                <>Base Score ({baseScore.toFixed(1)}) × GenAI Amplification ({genAIAmplification.toFixed(1)}x) = {totalAppRiskScore.toFixed(1)}</>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Scope Risk Section */}
      {hasScopeRisk ? (
        <div className="space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900">Scope Risk Assessment</h3>
                    <p className="text-sm text-gray-500">Risk multipliers based on application scope and user base</p>
                </div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-shrink-0">
                    <Badge variant="secondary" className="text-sm bg-gray-100 text-gray-700">
                        Scope Risk: {currentScopeRisk}
                    </Badge>
                    <Badge variant="outline" className="text-sm px-4 py-2 border-gray-400 bg-gray-900 text-white font-bold">
                        Scope Amplification: {scopeAmplification.toFixed(1)}x
                    </Badge>
                </div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
                    <div>
                        <div className="font-medium text-gray-900 text-sm">Scope Amplification Factor</div>
                        <div className="text-xs text-gray-600">
                            Scope Score ({scopeScore.toFixed(1)}) ÷ AI Score ({aiScore.toFixed(1)}) = {scopeAmplification.toFixed(1)}x
                        </div>
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                {Object.entries(scoringCriteria).map(([categoryKey, category]) => {
                    const scopeMultiplier = scopeMultipliers[categoryKey as keyof typeof scopeMultipliers] as number;
                    const aiMultiplier = multipliers[categoryKey as keyof typeof multipliers] as number;
                    const numScore = app?.[category.averageField] ? Number.parseFloat(app[category.averageField]) : 0;
                    const baseCatScore = numScore * (category.weight / 100) * 2;
                    const aiCatScore = baseCatScore * aiMultiplier;
                    const scopeCatScore = aiCatScore * scopeMultiplier;
                    const isAffected = scopeMultiplier > 1.0;
                    return (
                        <Card key={categoryKey} className="p-3 border-gray-200">
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="font-medium text-xs text-gray-900 leading-tight">{category.name}</div>
                                    <Badge variant="secondary" className={`text-xs px-2 py-1 ${isAffected ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
                                        ×{scopeMultiplier}
                                    </Badge>
                                </div>
                                <div className="bg-gray-50 rounded p-2">
                                    <div className="text-xs text-gray-600 space-y-1">
                                        <div className="flex justify-between"><span>AI Score:</span><span className="font-medium">{aiCatScore.toFixed(1)}</span></div>
                                        <div className="border-t border-gray-200 pt-1 flex justify-between font-medium"><span>Scope Score:</span><span className={isAffected ? 'text-gray-900' : 'text-gray-600'}>{scopeCatScore.toFixed(1)}</span></div>
                                    </div>
                                </div>
                            </div>
                        </Card>
                    );
                })}
            </div>
        </div>
      ) : (
        <div className="space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                    <h3 className="text-lg font-semibold text-gray-900">Scope Risk Assessment</h3>
                    <p className="text-sm text-gray-500">Risk multipliers based on application scope and user base</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                    <Badge variant="secondary" className="text-sm bg-gray-100 text-gray-700">Not Applicable</Badge>
                </div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="text-center text-gray-600"><p className="text-sm">Scope risk data is not available for this application.</p></div>
            </div>
        </div>
      )}

      {/* GenAI Risk Section */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">GenAI Risk Assessment</h3>
            <p className="text-sm text-gray-500">AI-specific risk calculations and amplification factor</p>
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-shrink-0">
            <Badge variant="secondary" className="text-sm bg-gray-100 text-gray-700">AI Status: {aiStatus}</Badge>
            <Badge variant="outline" className="text-sm px-4 py-2 border-gray-400 bg-gray-900 text-white font-bold">GenAI Amplification: {genAIAmplification.toFixed(1)}x</Badge>
          </div>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
                <div>
                    <div className="font-medium text-gray-900 text-sm">GenAI Amplification Factor</div>
                    <div className="text-xs text-gray-600">AI Score ({aiScore.toFixed(1)}) ÷ Base Score ({baseScore.toFixed(1)}) = {genAIAmplification.toFixed(1)}x</div>
                </div>
            </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            {Object.entries(scoringCriteria).map(([categoryKey, category]) => {
                const multiplier = multipliers[categoryKey as keyof typeof multipliers] as number;
                const numScore = app?.[category.averageField] ? Number.parseFloat(app[category.averageField]) : 0;
                const baseCatScore = numScore * (category.weight / 100) * 2;
                const adjustedScore = baseCatScore * multiplier;
                const isAffected = multiplier > 1.0;
                return (
                    <Card key={categoryKey} className="p-3 border-gray-200">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="font-medium text-xs text-gray-900 leading-tight">{category.name}</div>
                                <Badge variant="secondary" className={`text-xs px-2 py-1 ${isAffected ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>×{multiplier}</Badge>
                            </div>
                            <div className="bg-gray-50 rounded p-2">
                                <div className="text-xs text-gray-600 space-y-1">
                                    <div className="flex justify-between"><span>Base:</span><span className="font-medium">{baseCatScore.toFixed(1)}</span></div>
                                    <div className="border-t border-gray-200 pt-1 flex justify-between font-medium"><span>AI Score:</span><span className={isAffected ? 'text-gray-900' : 'text-gray-600'}>{adjustedScore.toFixed(1)}</span></div>
                                </div>
                            </div>
                        </div>
                    </Card>
                );
            })}
        </div>
      </div>

      {/* Base Risk Assessment */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Base Risk Assessment</h3>
            <p className="text-sm text-gray-500">Detailed scoring across all risk categories</p>
          </div>
          {finalScore && (
            <Badge variant="outline" className="text-sm px-4 py-2 border-gray-400 bg-gray-50 text-gray-900 font-bold flex-shrink-0">
              App Risk Score: {Number.parseFloat(finalScore).toFixed(1)}
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {Object.entries(scoringCriteria).map(([categoryKey, category]) => {
            const averageScore = app?.[category.averageField];
            const numScore = averageScore ? Number.parseFloat(averageScore) : 0;
            const weightedScore = numScore * (category.weight / 100) * 2;
            return (
              <Card key={categoryKey} className="h-full border-gray-200">
                <CardHeader className="pb-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-base mb-2 text-gray-900">{category.name}</CardTitle>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-600">{category.weight}% weight</Badge>
                          <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-600">Avg: {numScore > 0 ? numScore.toFixed(1) : 'N/A'}/5</Badge>
                        </div>
                        <div className="text-xs text-gray-500">Formula: {numScore > 0 ? numScore.toFixed(1) : 'N/A'} × {category.weight}% × 2</div>
                      </div>
                    </div>
                    <Badge variant="secondary" className="ml-2 bg-gray-900 text-white">{weightedScore > 0 ? weightedScore.toFixed(1) : 'N/A'}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-3">
                    {category.criteria.map((criterion: any) => {
                      const score = app?.[criterion.field];
                      const numericScore = score ? Number.parseFloat(score) : 0;
                      const rubricDefinition = getScoreDefinition(categoryKey, criterion.rubricKey, numericScore);
                      return (
                        <div key={criterion.field} className="flex items-start gap-3">
                          <div className="flex flex-col items-center flex-shrink-0">
                            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-medium">{numericScore || 'N/A'}</div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm mb-1 text-gray-900">{criterion.rubricKey}</div>
                            <div className="text-xs text-gray-600 line-clamp-2">{rubricDefinition?.description || 'No scoring information available'}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}; 