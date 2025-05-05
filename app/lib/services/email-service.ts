import { LoopsClient, APIError, RateLimitExceededError } from "loops";

const loops = new LoopsClient(process.env.LOOPS_API_KEY!);

export interface AppNotificationData {
  to: string;
  userName?: string;
  appName: string;
  organizationName?: string;
  detectionTime?: string;
  riskLevel?: string;
  category?: string;
  userCount?: number;
  totalPermissions?: number;
  notificationType: 'new_app' | 'new_user' | 'new_user_review';
  subjectPrefix?: string;
}

export class EmailService {
  // Template IDs from your Loops.so dashboard
  private static readonly NEW_APP_TEMPLATE_ID = process.env.NEW_APP_TEMPLATE_ID!;
  private static readonly NEW_USER_TEMPLATE_ID = process.env.NEW_USER_TEMPLATE_ID!;
  private static readonly NEW_USER_REVIEW_TEMPLATE_ID = process.env.NEW_USER_REVIEW_TEMPLATE_ID!;

  private static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private static getSubjectForNotificationType(data: AppNotificationData): string {
    const prefix = data.subjectPrefix || 'Shadow IT Alert';
    
    switch (data.notificationType) {
      case 'new_app':
        return `${prefix}: New App Detected - ${data.appName}`;
      case 'new_user':
        return `${prefix}: New User Added to ${data.appName}`;
      case 'new_user_review':
        return `${prefix}: New User Added to Review-flagged App ${data.appName}`;
      default:
        return `${prefix}: Shadow IT Notification`;
    }
  }

  private static getTemplateIdForType(notificationType: string): string {
    switch (notificationType) {
      case 'new_app':
        return this.NEW_APP_TEMPLATE_ID;
      case 'new_user':
        return this.NEW_USER_TEMPLATE_ID;
      case 'new_user_review':
        return this.NEW_USER_REVIEW_TEMPLATE_ID;
      default:
        return this.NEW_APP_TEMPLATE_ID; // Default to new app template
    }
  }

  private static async sendNotificationEmail(data: AppNotificationData) {
    if (!this.isValidEmail(data.to)) {
      console.error('Invalid email address:', data.to);
      throw new Error('Invalid email address');
    }

    try {
      // Get the appropriate template ID
      const templateId = this.getTemplateIdForType(data.notificationType);
      
      // Generate subject if not provided
      const subject = this.getSubjectForNotificationType(data);

      console.log(`Sending ${data.notificationType} notification to ${data.to} for app ${data.appName}`);

      // Common variables for all notification types
      const commonVariables = {
        app_name: data.appName,
        organization_name: data.organizationName || '',
        risk_level: data.riskLevel || 'Unknown',
        category: data.category || 'Uncategorized',
        total_permissions: data.totalPermissions || 0,
        subject_name: subject
      };

      // Template-specific variables
      let templateVariables: Record<string, any> = {};
      
      switch (data.notificationType) {
        case 'new_app':
          templateVariables = {
            ...commonVariables,
            number_permissions: data.totalPermissions || 0,
            total_users: data.userCount || 0,
            user_count: data.userCount || 0,
            detection_time: data.detectionTime || new Date().toISOString()
          };
          break;
        
        case 'new_user':
        case 'new_user_review':
          templateVariables = {
            ...commonVariables,
            user_name: data.userName || '',
            user_email: data.userName || '', // Using userName as email if needed
            user_number_permissions: data.totalPermissions || 0,
            app_status: data.notificationType === 'new_user_review' ? 'Needs Review' : ''
          };
          break;
      }

      // Send the email
      await loops.sendTransactionalEmail({
        transactionalId: templateId,
        email: data.to,
        addToAudience: true,
        dataVariables: templateVariables
      });

      console.log(`Successfully sent ${data.notificationType} notification email to ${data.to}`);
      return true;
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        console.error(`Rate limit exceeded (${error.limit} per second)`);
        throw error;
      } else if (error instanceof APIError) {
        console.error('API Error:', JSON.stringify(error.json));
        console.error('Status code:', error.statusCode);
        throw error;
      } else {
        console.error('Failed to send email:', error);
        throw error;
      }
    }
  }

  static async sendNewAppNotification(data: Omit<AppNotificationData, 'notificationType'>) {
    return this.sendNotificationEmail({
      ...data,
      notificationType: 'new_app'
    });
  }

  static async sendNewUserNotification(data: Omit<AppNotificationData, 'notificationType'>) {
    return this.sendNotificationEmail({
      ...data,
      notificationType: 'new_user'
    });
  }

  static async sendNewUserReviewNotification(data: Omit<AppNotificationData, 'notificationType'>) {
    return this.sendNotificationEmail({
      ...data,
      notificationType: 'new_user_review'
    });
  }

  // Utility method to test if API key is valid
  static async testApiKey() {
    try {
      const response = await loops.testApiKey();
      return true; // If no error is thrown, the key is valid
    } catch (error) {
      if (error instanceof APIError) {
        console.error('Invalid API key');
        return false;
      }
      throw error;
    }
  }
} 