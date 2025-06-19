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

// Helper function to update categorization status
export async function updateCategorizationStatus(statusId: string, progress: number, message: string, status: string = 'IN_PROGRESS') {
  try {
    const updateData: any = {
      status,
      updated_at: new Date().toISOString()
    };

    // Only include progress and message if the columns exist
    if (progress !== undefined) {
      updateData.progress = progress;
    }
    if (message) {
      updateData.message = message;
    }

    const { error } = await supabaseAdmin
      .from('categorization_status')
      .update(updateData)
      .eq('id', statusId);
      
    if (error) {
      console.error(`Error updating categorization status: ${error.message}`);
      return false;
    }
    
    return true;
  } catch (err) {
    console.error('Unexpected error in updateCategorizationStatus:', err);
    return false;
  }
}

// Helper function to create a new categorization status
export async function createCategorizationStatus(organizationId: string, applicationId?: string) {
  try {
    const insertData: any = {
      organization_id: organizationId,
      status: 'PENDING',
      progress: 0,
      message: 'Initializing categorization process',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Only include application_id if provided
    if (applicationId) {
      insertData.application_id = applicationId;
    }

    const { data, error } = await supabaseAdmin
      .from('categorization_status')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('Error creating categorization status:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Unexpected error in createCategorizationStatus:', error);
    return null;
  }
}

export async function categorizeApplications(organization_id: string, categorization_id: string) {
  try {
    console.log(`[Categorize] Starting categorization for organization: ${organization_id}`);
    
    await updateCategorizationStatus(categorization_id, 10, 'Fetching applications to categorize');
    
    // Fetch all applications that need categorization
    const { data: applications, error: fetchError } = await supabaseAdmin
      .from('applications')
      .select('id, name, all_scopes, category, microsoft_app_id')
      .eq('organization_id', organization_id)
      .or('category.is.null,category.eq.uncategorized,category.eq.Unknown,category.eq.Others');
    
    if (fetchError) {
      console.error(`[Categorize] Error fetching applications:`, fetchError);
      await updateCategorizationStatus(categorization_id, 0, 'Error fetching applications', 'ERROR');
      throw fetchError;
    }
    
    console.log(`[Categorize] Found ${applications?.length || 0} applications to categorize`);
    
    if (!applications || applications.length === 0) {
      console.log(`[Categorize] No applications need categorization`);
      await updateCategorizationStatus(categorization_id, 100, 'No applications needed categorization', 'COMPLETED');
      return;
    }

    // Process applications in smaller batches for better progress tracking
    const batchSize = 5;
    let categorizedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < applications.length; i += batchSize) {
      const batch = applications.slice(i, i + batchSize);
      
      // Process each application in the batch
      await Promise.all(batch.map(async (app) => {
        try {
          // Determine category based on name and scopes
          const category = await categorizeApplication(app.name, app.all_scopes || [], !!app.microsoft_app_id);
          console.log(`[Categorize] Determined category for ${app.name}: ${category}`);
          
          // Update application with new category
          const { error: updateError } = await supabaseAdmin
            .from('applications')
            .update({ 
              category,
              updated_at: new Date().toISOString()
            })
            .eq('id', app.id);
            
          if (updateError) {
            console.error(`[Categorize] Error updating category for app ${app.id}:`, updateError);
            errorCount++;
          } else {
            console.log(`[Categorize] Successfully categorized app ${app.name} as ${category}`);
            categorizedCount++;
          }
        } catch (error) {
          console.error(`[Categorize] Error processing app ${app.name}:`, error);
          errorCount++;
        }
      }));

      // Update progress after each batch
      const progress = Math.min(Math.round((i + batch.length) / applications.length * 100), 99);
      await updateCategorizationStatus(
        categorization_id,
          progress,
        `Processed ${i + batch.length} of ${applications.length} applications`
      );
    }
    
    // Final update
    const finalStatus = errorCount > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
    const finalMessage = `Completed categorization. Success: ${categorizedCount}, Errors: ${errorCount}`;
    console.log(`[Categorize] ${finalMessage}`);
    await updateCategorizationStatus(categorization_id, 100, finalMessage, finalStatus);
    
  } catch (error: any) {
    console.error(`[Categorize] Error in categorizeApplications:`, error);
    await updateCategorizationStatus(
      categorization_id,
      0,
      `Categorization failed: ${error.message}`,
      'FAILED'
    );
    throw error;
  }
}

// export const maxDuration = 300; // Set max duration to 300 seconds (5 minutes)
// export const dynamic = 'force-dynamic';
// export const runtime = 'nodejs'; // Enable Fluid Compute by using nodejs runtime

export async function POST(request: Request) {
  try {
    const { organization_id } = await request.json();

    if (!organization_id) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // Check if there's already an active categorization process for this organization
    const { data: existingProcess, error: queryError } = await supabaseAdmin
      .from('categorization_status')
      .select('id, status, progress')
      .eq('organization_id', organization_id)
      .in('status', ['PENDING', 'IN_PROGRESS'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (queryError) {
      console.error('Error checking existing categorization processes:', queryError);
      return NextResponse.json({ error: 'Failed to check existing categorization processes' }, { status: 500 });
    }

    // If there's already an active process, return its ID instead of creating a new one
    if (existingProcess && existingProcess.length > 0) {
      console.log(`Found existing categorization process (${existingProcess[0].id}) for organization ${organization_id}, status: ${existingProcess[0].status}, progress: ${existingProcess[0].progress}%`);
      return NextResponse.json({
        message: 'Categorization already in progress',
        categorization_id: existingProcess[0].id,
        status: existingProcess[0].status,
        progress: existingProcess[0].progress
      });
    }

    // Create a new categorization status record
    const { data: statusRecord, error: statusError } = await supabaseAdmin
      .from('categorization_status')
      .insert({
        organization_id,
        status: 'PENDING',
        progress: 0,
        message: 'Initializing categorization process',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (statusError) {
      console.error('Error creating categorization status:', statusError);
      return NextResponse.json({ error: 'Failed to create categorization status' }, { status: 500 });
    }

    // Start categorization in the background
    categorizeApplications(organization_id, statusRecord.id).catch(error => {
      console.error('Background categorization failed:', error);
      updateCategorizationStatus(
        statusRecord.id,
        0,
        `Categorization failed: ${error.message}`,
        'FAILED'
      );
    });

    // Return the status record ID immediately
    return NextResponse.json({ 
      message: 'Categorization process started',
      categorization_id: statusRecord.id
    });

  } catch (error) {
    console.error('[Categorize] Error in categorization route:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Function to categorize an application using ChatGPT
async function categorizeApplication(appName: string, scopes: string[] = [], isMicrosoftApp: boolean = false): Promise<string> {
  try {
    // If OpenAI API key is not set, use heuristic approach
    if (!process.env.OPENAI_API_KEY) {
      return categorizeWithHeuristics(appName, scopes, isMicrosoftApp);
    }

    // Prepare the prompt with application name and scopes
    const prompt = `Please categorize the following ${isMicrosoftApp ? 'Microsoft' : ''} application into exactly one of these categories:
${categories.join(', ')}

Application name: ${appName}
${scopes && scopes.length > 0 ? `Scopes/Permissions: ${scopes.slice(0, 20).join(', ')}${scopes.length > 20 ? '...' : ''}` : ''}
${isMicrosoftApp ? 'Note: This is a Microsoft application, so consider Microsoft-specific services and products in your categorization.' : ''}

Respond with only the category name as a string.`;

    // Make ChatGPT API request
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { 
            role: 'system', 
            content: `You are an expert assistant designed to categorize software applications connected to a company's systems via OAuth scopes. Assign each application to exactly one of the following functional categories, based on its primary business function.
Categories & Robust Definitions
1. Analytics & Business Intelligence
Definition: Tools for collecting, analyzing, querying, or visualizing data to support business decisions, research, or reporting.
Examples: Google Analytics, Tableau, PowerBI, Looker, Perplexity, Relevance AI, SimilarWeb, SerpApi, ThoughtSpot, Amplitude, Mixpanel
Signals: Dashboards, reporting, insights, data visualization, analytics APIs, market/SEO research, search analytics
2. Cloud Platforms & Infrastructure
Definition: Services providing hosting, cloud storage, compute, databases, or serverless infrastructure.
Examples: AWS, Google Cloud, Azure, DigitalOcean, Vercel, Netlify, Heroku, Cloudflare, MongoDB Atlas, Supabase
Signals: Hosting, cloud storage, compute resources, serverless, managed databases
3. Customer Success & Support
Definition: Tools for customer service, ticketing, help desks, onboarding, or feedback collection.
Examples: Zendesk, Intercom, Freshdesk, Help Scout, Front, Gorgias, Kustomer, Statuspage, SurveyMonkey
Signals: Ticketing, chat support, help center, customer feedback, support automation
4. Design & Creative Tools
Definition: Applications for visual design, prototyping, UI/UX, video editing, illustration, or creative content production.
Examples: Figma, Adobe Creative Cloud, Canva, Sketch, InVision, Miro, Blender, Photoshop, Webflow
Signals: Design canvases, prototyping, creative asset libraries, visual editing
5. Developer & Engineering Tools
Definition: Tools for software development, code repositories, programming, testing, CI/CD, or developer collaboration. Includes AI coding assistants.
Examples: GitHub, GitLab, VS Code, Cursor, Replit, Postman, Codeium, JetBrains, Docker, Jenkins, Travis CI, CodeSandbox, HackerRank
Signals: Code editing, version control, developer APIs, testing frameworks, AI code completion, coding assessments
6. Finance & Accounting
Definition: Apps for financial management, accounting, billing, invoicing, payroll, or expense tracking.
Examples: QuickBooks, Xero, Stripe, FreshBooks, Bill.com, Expensify, Brex, Mercury, Wave, NetSuite
Signals: Accounting, billing, payment processing, expense management, payroll
7. Human Resources & People Management
Definition: Tools for recruiting, onboarding, performance reviews, compensation, or employee engagement.
Examples: Workday, BambooHR, Gusto, Lattice, Greenhouse, Lever, Culture Amp, 15Five, Rippling
Signals: Employee data, recruitment, onboarding, performance tracking, HR workflows
8. IT Operations & Security
Definition: Solutions for monitoring, security enforcement, compliance, device management, or infrastructure health.
Examples: Datadog, PagerDuty, New Relic, Splunk, Crowdstrike, 1Password for Business, Snyk, LastPass
Signals: Monitoring, security features, compliance, device management, incident response
9. Identity & Access Management
Definition: Tools focused on authentication, authorization, SSO, or user provisioning.
Examples: Okta, Auth0, OneLogin, Microsoft Entra ID, Google Workspace Admin, JumpCloud
Signals: User authentication, SSO, permission management, directory services
10. Productivity & Collaboration
Definition: Apps that help teams communicate, share information, organize work, or collaborate on content. Includes AI chat assistants and business communication tools.
Examples: Slack, Microsoft Teams, Zoom, Google Workspace, Notion, Asana, Airtable, Evernote, Calendly, Loom, chat.deepseek.com, Claude, ChatGPT, Dialpad, Miro
Signals: Messaging, video meetings, document sharing, note-taking, scheduling, collaborative workspaces, AI chat assistants
11. Project Management
Definition: Tools for managing tasks, workflows, projects, timelines, or agile sprints.
Examples: Jira, Asana, Monday.com, ClickUp, Trello, Basecamp, Linear, Smartsheet, Wrike, Height
Signals: Task boards, Gantt charts, sprint planning, resource allocation, project timelines
12. Sales & Marketing
Definition: Apps for CRM, lead generation, outreach, email campaigns, content marketing, social media, or SEO.
Examples: Salesforce, HubSpot, Mailchimp, Marketo, Hootsuite, G2.com, Hunter.io, Semrush, Ahrefs, Manus, Loops
Signals: Contact management, email marketing, lead tracking, campaign analytics, review platforms, outreach automation
13. Others
Definition: Use only if the app is strictly personal, consumer-focused, experimental/internal with no clear business function, or cannot reasonably fit any above category.
Examples: Gaming apps, dating apps, entertainment streaming, personal fitness, unclear or experimental tools
Assignment Guidelines
Assign the single most appropriate category based on the application's main business function.
If the app is well-known, use public knowledge to assign the most widely recognized business category.
Use all available clues (name, description, OAuth scopes, known use cases) to make a confident assignment.
"Others" should be rare and only used after all categories have been reasonably ruled out.
If at least 70% confident, assign the best-fit category rather than defaulting to "Others."
Do not assign based on name alone-use function, features, and context.
Final Output
Return only the exact category name as your final response.
Do not return explanations, just the category.`
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
      return categorizeWithHeuristics(appName, scopes, isMicrosoftApp); // Fallback to heuristics
    }

    // Extract the category from the response
    const result = data.choices?.[0]?.message?.content?.trim() || '';
    
    // Validate against our list of categories
    const category = categories.find(c => 
      result === c || 
      result.toLowerCase() === c.toLowerCase() ||
      c.toLowerCase().includes(result.toLowerCase())
    );
    
    return category || categorizeWithHeuristics(appName, scopes, isMicrosoftApp);
  } catch (error) {
    console.error('Error categorizing with ChatGPT:', error);
    return categorizeWithHeuristics(appName, scopes, isMicrosoftApp);
  }
}

// Fallback function that uses simple heuristics to categorize applications
function categorizeWithHeuristics(appName: string, scopes: string[] = [], isMicrosoftApp: boolean = false): string {
  const nameAndScopes = `${appName.toLowerCase()} ${scopes.join(' ').toLowerCase()}`;

  // Define Microsoft-specific keywords for categories
  const microsoftKeywords: Record<string, string[]> = {
    "Identity & Access Management": [
      'azure ad', 'active directory', 'entra', 'identity', 'authentication', 'access', 'login',
      'directory', 'credential', 'permission', 'role', 'security', 'token', 'oauth', 'sso'
    ],
    "IT Operations & Security": [
      'intune', 'defender', 'security', 'compliance', 'monitor', 'audit', 'log', 'operation',
      'admin', 'management', 'policy', 'endpoint', 'device', 'sentinel'
    ],
    "Developer & Engineering Tools": [
      'visual studio', 'azure devops', 'github', 'dev center', 'dev', 'api', 'test', 'tool',
      'development', 'engineering', 'build', 'deploy', 'code', 'repository', 'git', 'pipeline'
    ],
    "Productivity & Collaboration": [
      'office', 'teams', 'outlook', 'sharepoint', 'onedrive', 'exchange', 'communication',
      'chat', 'meet', 'collaborate', 'share', 'document', 'file'
    ],
    "Cloud Platforms & Infrastructure": [
      'azure', 'cloud', 'infrastructure', 'platform', 'service', 'resource', 'compute',
      'storage', 'network', 'container', 'kubernetes', 'function'
    ]
  };

  // Define general keywords for categories
  const generalKeywords: Record<string, string[]> = {
    "Analytics & Business Intelligence": [
      'analytics', 'dashboard', 'report', 'bi', 'data', 'metric', 'insight', 'chart',
      'powerbi', 'power bi', 'azure analysis'
    ],
    "Customer Success & Support": [
      'support', 'ticket', 'help', 'customer', 'service', 'chat', 'feedback',
      'dynamics crm', 'dynamics 365', 'customer service'
    ],
    "Design & Creative Tools": [
      'design', 'creative', 'image', 'photo', 'video', 'media', 'art', 'graphic',
      'visio', 'designer'
    ],
    "Finance & Accounting": [
      'finance', 'accounting', 'payment', 'invoice', 'expense', 'budget', 'tax',
      'dynamics finance', 'microsoft financials'
    ],
    "Human Resources & People Management": [
      'hr', 'people', 'employee', 'recruit', 'talent', 'hiring', 'onboard', 'payroll',
      'dynamics hr', 'talent management', 'viva'
    ],
    "Project Management": [
      'project', 'task', 'manage', 'plan', 'agile', 'sprint', 'board', 'timeline',
      'project online', 'planner', 'azure boards'
    ],
    "Sales & Marketing": [
      'sales', 'crm', 'lead', 'market', 'brand', 'campaign', 'social', 'email',
      'dynamics sales', 'dynamics marketing', 'dynamics 365'
    ]
  };

  // Score each category based on keyword matches
  const scores: Record<string, number> = {};
  
  // If it's a Microsoft app, first check Microsoft-specific categories
  if (isMicrosoftApp) {
    for (const [category, keywords] of Object.entries(microsoftKeywords)) {
      scores[category] = 0;
      for (const keyword of keywords) {
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        if (regex.test(nameAndScopes)) {
          scores[category] += 3; // Higher weight for Microsoft-specific matches
        } else if (nameAndScopes.includes(keyword)) {
          scores[category] += 2;
        }
      }
    }
  }

  // Then check general categories
  for (const [category, keywords] of Object.entries(generalKeywords)) {
    scores[category] = scores[category] || 0;
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(nameAndScopes)) {
        scores[category] += 2;
      } else if (nameAndScopes.includes(keyword)) {
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