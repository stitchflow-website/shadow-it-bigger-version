import { supabaseAdmin } from '@/lib/supabase';

/**
 * Send a webhook notification for user sign-up events
 * 
 * @param userEmail - The email of the user
 * @param userName - The name of the user
 * @param isSuccess - Whether the sign-up was successful
 * @param reason - Reason for failed sign-up (if applicable)
 * @param provider - Authentication provider (google, microsoft)
 * @returns Promise<boolean> - Whether the webhook was sent successfully
 */
export async function sendUserWebhook(
  userEmail: string, 
  userName: string, 
  reason?: string
): Promise<boolean> {
  try {
    // First check if the user already exists in the successful signups database
    const { data: existingUser } = await supabaseAdmin
      .from('users_signedup')
      .select('id')
      .eq('email', userEmail)
      .single();
    
    // Also check if the user already exists in the failed signups database
    const { data: existingFailedUser } = await supabaseAdmin
      .from('users_failed_signups')
      .select('id')
      .eq('email', userEmail)
      .limit(1);
    
    // Only send webhook if this is a completely new user (not in either table)
    const isNewUser = !existingUser && (!existingFailedUser || existingFailedUser.length === 0);
    
    if (isNewUser) {
      console.log(`User ${userEmail} is new, sending webhook notification`);
      
      const webhookResponse = await fetch('https://primary-production-d8d8.up.railway.app/webhook/d98b3a82-3ac8-44d0-b28f-ea7682badee2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + Buffer.from('thamim:G7#kL9@vB3!mQ2$z').toString('base64')
        },
        body: JSON.stringify({
          user_email: userEmail,
          app_name: 'Shadow IT',
          user_name: userName || '',
          reason: reason || ''
        })
      });

      if (!webhookResponse.ok) {
        console.error('Failed to send webhook:', await webhookResponse.text());
        return false;
      } else {
        console.log('Successfully sent webhook notification');
        return true;
      }
    } else {
      // Log different messages based on where the user was found
      if (existingUser) {
        console.log(`User ${userEmail} already exists in successful signups, skipping webhook notification`);
      } else {
        console.log(`User ${userEmail} already exists in failed signups, skipping webhook notification`);
      }
      return false;
    }
  } catch (webhookError) {
    console.error('Error sending webhook:', webhookError);
    return false;
  }
}

/**
 * Send a webhook notification for successful user sign-up
 * 
 * @param userEmail - The email of the user
 * @param userName - The name of the user
 * @param provider - Authentication provider (google, microsoft)
 * @returns Promise<boolean> - Whether the webhook was sent successfully
 */
export async function sendSuccessSignupWebhook(
  userEmail: string, 
  userName: string,
  reason:string = ''
): Promise<boolean> {
  return sendUserWebhook(userEmail, userName, reason);
}

/**
 * Send a webhook notification for failed user sign-up
 * 
 * @param userEmail - The email of the user
 * @param userName - The name of the user
 * @param reason - Reason for the failure
 * @param provider - Authentication provider (google, microsoft)
 * @returns Promise<boolean> - Whether the webhook was sent successfully
 */
export async function sendFailedSignupWebhook(
  userEmail: string, 
  userName: string,
  reason: string
): Promise<boolean> {
  return sendUserWebhook(userEmail, userName, reason);
} 