export interface Application {
  id: string;
  name: string;
  category: string | null;
  lastUsed: string;
  userCount: number;
  riskScore: number;
} 