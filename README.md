# Shadow IT Management Dashboard

A comprehensive dashboard for managing and monitoring shadow IT applications across your organization.

## Features

- **Automated Discovery**: Automatically discover and catalog applications being used across your organization
- **Risk Assessment**: Identify high-risk applications based on permissions and scopes
- **User Tracking**: Monitor which users have access to what applications
- **Management Status**: Track which applications are managed vs. unmanaged
- **AI-Powered Categorization**: Automatically categorize applications using ChatGPT

## Application Categorization

The system uses OpenAI's ChatGPT to automatically categorize applications into the following categories:

- Analytics & Business Intelligence
- Cloud Platforms & Infrastructure
- Customer Success & Support
- Design & Creative Tools
- Developer & Engineering Tools
- Finance & Accounting
- Human Resources & People Management
- IT Operations & Security
- Identity & Access Management
- Productivity & Collaboration
- Project Management
- Sales & Marketing
- Others

The categorization happens automatically during the background sync process when applications are discovered or updated. If the OpenAI API key is not provided, the system falls back to a rule-based categorization using keyword matching.

## Setup

1. Clone the repository
2. Copy `.env.example` to `.env.local` and fill in the required values
3. Install dependencies: `npm install`
4. Run the development server: `npm run dev`
5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Environment Variables

See `.env.example` for required environment variables. For application categorization, you'll need:

```
# OpenAI API (for categorizing applications)
OPENAI_API_KEY=your-openai-api-key
```

## Background Tasks

The system uses background tasks to:

1. Fetch users from Google Workspace
2. Fetch application tokens and permissions
3. Categorize applications using ChatGPT
4. Create relationships between users and applications

These tasks run automatically during the sync process. 