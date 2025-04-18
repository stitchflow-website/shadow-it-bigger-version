import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// List of predefined categories we want to map applications to
const categories = [
  "Analytics & Business Intelligence",
  "Cloud Platforms & Infrastructure",
  "Customer Success & Support",
  "Design & Creative Tools",
  "Developer & Engineering Tools",
  "Finance & Accounting",
  "Human Resources & People Management",
  "IT Operations & Security",
  "Identity & Access Management",
  "Productivity & Collaboration",
  "Project Management",
  "Sales & Marketing",
  "Others"
];

// Helper function to update sync status
async function updateSyncStatus(syncId: string, progress: number, message: string, status: string = 'IN_PROGRESS') {
  try {
    const { error } = await supabaseAdmin
      .from('sync_status')
      .update({
        status,
        progress,
        message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', syncId);
      
    if (error) {
      console.error(`Error updating sync status: ${error.message}`);
    }
    
    return { success: !error };
  } catch (err) {
    console.error('Unexpected error in updateSyncStatus:', err);
    return { success: false };
  }
}

export const maxDuration = 300; // Set max duration to 300 seconds (5 minutes)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // Enable Fluid Compute by using nodejs runtime

export async function POST(request: Request) {
  try {
    const requestData = await request.json();
    const { organization_id } = requestData;

    if (!organization_id) {
      return NextResponse.json(
        { error: 'Missing organization_id' },
        { status: 400 }
      );
    }

    // Start categorization in background without blocking
    categorizeApplications(organization_id)
      .catch(error => {
        console.error('Background categorization failed:', error);
      });

    // Return immediate success response
    return NextResponse.json({ 
      message: 'Application categorization started in background',
      status: 'IN_PROGRESS'
    });

  } catch (error: any) {
    console.error('Error in categorization API:', error);
    return NextResponse.json(
      { error: 'Failed to start categorization', details: error.message },
      { status: 500 }
    );
  }
}

async function categorizeApplications(organization_id: string) {
  try {
    console.log(`[Categorize] Starting background categorization for organization: ${organization_id}`);
    
    // Fetch all applications that need categorization
    const { data: applications, error: fetchError } = await supabaseAdmin
      .from('applications')
      .select('id, name, all_scopes, category')
      .eq('organization_id', organization_id)
      .or('category.is.null,category.eq.Unknown');
    
    if (fetchError) {
      console.error(`[Categorize] Error fetching applications:`, fetchError);
      throw fetchError;
    }
    
    console.log(`[Categorize] Found ${applications?.length || 0} applications to categorize`);
    
    if (!applications || applications.length === 0) {
      console.log(`[Categorize] No applications need categorization`);
      return;
    }

    // Initialize categorization status for all applications
    const categorizationStatuses = applications.map(app => ({
      application_id: app.id,
      organization_id: organization_id,
      status: 'IN_PROGRESS' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    // Insert initial status records
    const { error: statusError } = await supabaseAdmin
      .from('categorization_status')
      .upsert(categorizationStatuses, { 
        onConflict: 'application_id',
        ignoreDuplicates: false
      });

    if (statusError) {
      console.error(`[Categorize] Error initializing categorization status:`, statusError);
    }
    
    // Process applications in batches to avoid rate limits and timeout
    const batchSize = 10;
    let processed = 0;
    
    for (let i = 0; i < applications.length; i += batchSize) {
      const batch = applications.slice(i, Math.min(i + batchSize, applications.length));
      
      // Categorize each application in the batch
      const categorizedBatch = await Promise.all(batch.map(async (app) => {
        try {
          const category = await categorizeApplication(app.name, app.all_scopes);
          return {
            id: app.id,
            category,
            success: true
          };
        } catch (error) {
          console.error(`[Categorize] Error categorizing app ${app.id}:`, error);
          return {
            id: app.id,
            success: false
          };
        }
      }));
      
      // Update the database with the categorized applications
      for (const app of categorizedBatch) {
        if (!app.success) {
          // Update status to failed
          await supabaseAdmin
            .from('categorization_status')
            .update({ 
              status: 'FAILED',
              updated_at: new Date().toISOString()
            })
            .eq('application_id', app.id);
          continue;
        }

        // Update application category
        const { error: updateError } = await supabaseAdmin
          .from('applications')
          .update({ category: app.category })
          .eq('id', app.id);
          
        if (updateError) {
          console.warn(`[Categorize] Error updating category for app ${app.id}:`, updateError);
          // Update status to failed
          await supabaseAdmin
            .from('categorization_status')
            .update({ 
              status: 'FAILED',
              updated_at: new Date().toISOString()
            })
            .eq('application_id', app.id);
          continue;
        }

        // Update categorization status to completed
        await supabaseAdmin
          .from('categorization_status')
          .update({ 
            status: 'COMPLETED',
            updated_at: new Date().toISOString()
          })
          .eq('application_id', app.id);
      }
      
      processed += batch.length;
      console.log(`[Categorize] Processed ${processed}/${applications.length} applications`);
      
      // Pause briefly between batches to avoid overwhelming the API
      if (i + batchSize < applications.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.log(`[Categorize] Background categorization completed for ${processed} applications`);
    
  } catch (error: any) {
    console.error(`[Categorize] Error during background categorization:`, error);
    throw error;
  }
}

// Function to categorize an application using ChatGPT
async function categorizeApplication(appName: string, scopes: string[] = []): Promise<string> {
  try {
    // If OpenAI API key is not set, use a heuristic approach
    if (!process.env.OPENAI_API_KEY) {
      return categorizeWithHeuristics(appName, scopes);
    }

    // Prepare the prompt with application name and scopes
    const prompt = `Please categorize the following application into exactly one of these categories:
${categories.join(', ')}

Application name: ${appName}
${scopes && scopes.length > 0 ? `Scopes/Permissions: ${scopes.slice(0, 20).join(', ')}${scopes.length > 20 ? '...' : ''}` : ''}

Respond with only the category name as a string.`;

    // Make ChatGPT API request
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: 'You are a helpful assistant that categorizes applications. Respond only with the exact category name from the list provided.' 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3, // Lower temperature for more deterministic results
        max_tokens: 25  // Only need a short response
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error('Error from OpenAI API:', data);
      return 'Others'; // Fallback
    }

    // Extract the category from the response
    const result = data.choices?.[0]?.message?.content?.trim() || '';
    
    // Validate against our list of categories
    const category = categories.find(c => 
      result === c || 
      result.toLowerCase() === c.toLowerCase() ||
      c.toLowerCase().includes(result.toLowerCase())
    );
    
    return category || 'Others';
  } catch (error) {
    console.error('Error categorizing with ChatGPT:', error);
    return categorizeWithHeuristics(appName, scopes);
  }
}

// Fallback function that uses simple heuristics to categorize applications
function categorizeWithHeuristics(appName: string, scopes: string[] = []): string {
  const nameAndScopes = `${appName.toLowerCase()} ${scopes.join(' ').toLowerCase()}`;

  // Define keywords mapped to categories
  const categoryKeywords: Record<string, string[]> = {
    "Analytics & Business Intelligence": [
      'analytics', 'dashboard', 'report', 'bi', 'data', 'metric', 'insight', 'chart', 'tableau', 
      'looker', 'powerbi', 'metabase', 'amplitude', 'mixpanel'
    ],
    "Cloud Platforms & Infrastructure": [
      'cloud', 'aws', 'azure', 'gcp', 'infrastructure', 'platform', 'hosting', 'server', 'compute',
      'iaas', 'paas', 'heroku', 'kubernetes', 'docker', 'vercel', 'netlify'
    ],
    "Customer Success & Support": [
      'customer', 'support', 'ticket', 'help desk', 'service desk', 'zendesk', 'intercom', 'freshdesk',
      'helpdesk', 'customer success', 'chat', 'feedback', 'survey'
    ],
    "Design & Creative Tools": [
      'design', 'figma', 'sketch', 'adobe', 'canva', 'creative', 'prototyping', 'ux', 'ui',
      'illustrator', 'photoshop', 'indesign', 'video', 'audio', 'edit'
    ],
    "Developer & Engineering Tools": [
      'developer', 'engineering', 'code', 'git', 'github', 'gitlab', 'bitbucket', 'programming',
      'ide', 'api', 'ci/cd', 'jenkins', 'jira', 'confluence', 'atlassian', 'postman', 'testing'
    ],
    "Finance & Accounting": [
      'finance', 'accounting', 'invoice', 'expense', 'tax', 'payment', 'billing', 'quickbooks',
      'xero', 'stripe', 'paypal', 'budget', 'financial', 'bank'
    ],
    "Human Resources & People Management": [
      'hr', 'human resources', 'recruiting', 'talent', 'payroll', 'employee', 'benefits', 'workday',
      'bamboo', 'gusto', 'zenefits', 'performance', 'engagement', 'survey'
    ],
    "IT Operations & Security": [
      'it', 'security', 'monitoring', 'logging', 'alert', 'incident', 'devops', 'sysadmin',
      'network', 'firewall', 'vpn', 'siem', 'backup', 'identity'
    ],
    "Identity & Access Management": [
      'identity', 'authentication', 'access', 'sso', 'okta', 'auth0', 'oauth', 'iam',
      'login', 'mfa', '2fa', 'permission', 'user management'
    ],
    "Productivity & Collaboration": [
      'productivity', 'collaboration', 'document', 'chat', 'messaging', 'email', 'meeting', 'video',
      'conference', 'slack', 'zoom', 'google', 'microsoft', 'office', 'notion', 'asana', 'basecamp'
    ],
    "Project Management": [
      'project', 'task', 'manage', 'agile', 'scrum', 'kanban', 'trello', 'asana', 'monday',
      'wrike', 'clickup', 'jira', 'roadmap', 'plan', 'schedule'
    ],
    "Sales & Marketing": [
      'sales', 'marketing', 'crm', 'lead', 'campaign', 'email', 'social', 'advertising', 'seo', 'content',
      'hubspot', 'marketo', 'salesforce', 'mailchimp', 'hootsuite', 'buffer'
    ]
  };

  // Score each category based on keyword matches
  const scores: Record<string, number> = {};
  
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    scores[category] = 0;
    for (const keyword of keywords) {
      // Check for exact word match with word boundaries
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(nameAndScopes)) {
        scores[category] += 2;
      } else if (nameAndScopes.includes(keyword)) {
        // Partial match
        scores[category] += 1;
      }
    }
  }

  // Find the category with the highest score
  let bestCategory = 'Others';
  let highestScore = 0;
  
  for (const [category, score] of Object.entries(scores)) {
    if (score > highestScore) {
      highestScore = score;
      bestCategory = category;
    }
  }

  // If no good match, return "Others"
  return highestScore > 0 ? bestCategory : 'Others';
} 