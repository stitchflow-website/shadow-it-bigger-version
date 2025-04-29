# Admin Access Enforcement

## Overview

We've implemented checks to ensure that only users with administrative privileges in their Google Workspace or Microsoft Entra ID (formerly Azure AD) environments can sign up and use the application. This ensures that the application is only used by authorized administrators.

## Implementation Details

### Authentication Flow

1. When a user signs in via Google or Microsoft, we check if:
   - They are using a workspace/corporate account (not a personal account)
   - They have administrative privileges in their organization

2. If either check fails:
   - The user is redirected to the login page with an appropriate error message
   - The failed sign-up attempt is recorded in the `users_failed_signups` table for monitoring purposes
   - The user is not added to the `users_signedup` table

### Admin Detection Methods

#### Google Workspace
- We use the Google Directory API to check if the user has admin roles
- First we check directory roles directly
- If that fails, we attempt to list users - an operation only admins can perform

#### Microsoft Entra ID
- We check if the user is a member of admin groups or has admin roles
- We look for specific role template IDs for administrative roles
- As a fallback, we attempt to list users, which requires admin privileges

### Failed Sign-up Recording

Failed sign-up attempts are recorded in the `users_failed_signups` table with the following information:
- Email address
- Name
- Reason for rejection (not_workspace_account, not_admin)
- Authentication provider (google, microsoft)
- Domain (if applicable)
- Additional metadata
- Timestamp

This information is useful for:
- Monitoring potential unauthorized access attempts
- Understanding if there are legitimate users who need access but lack proper permissions
- Analyzing usage patterns

### Error Messages

- If a user attempts to sign in with a personal account, they'll see: "Please use a workspace/corporate account"
- If a user doesn't have admin privileges, they'll see: "Admin access required to use this application"

## Database Schema

The `users_failed_signups` table has the following structure:

```sql
CREATE TABLE public.users_failed_signups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    name TEXT,
    reason TEXT NOT NULL, -- 'not_workspace_account', 'not_admin', etc.
    provider TEXT NOT NULL, -- 'google', 'microsoft', etc.
    domain TEXT, -- Domain of the email if applicable
    metadata JSONB, -- Additional user data
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ
);
``` 