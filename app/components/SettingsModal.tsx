import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";

interface NotificationPreferences {
  new_app_detected: boolean;
  new_user_in_app: boolean;
  new_user_in_review_app: boolean;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [notificationSettings, setNotificationSettings] = useState<NotificationPreferences>({
    new_app_detected: true,
    new_user_in_app: true,
    new_user_in_review_app: true
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load user notification preferences on mount
  useEffect(() => {
    if (isOpen) {
      loadNotificationPreferences();
    }
  }, [isOpen]);

  const loadNotificationPreferences = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Read the orgId from cookie or URL parameters
      const orgId = getOrgIdFromCookieOrUrl();
      
      if (!orgId) {
        throw new Error('Organization ID not found. Please try logging in again.');
      }
      
      // Fetch user email from cookies
      const userEmail = getUserEmailFromCookie();
      
      if (!userEmail) {
        throw new Error('Session expired. Please try logging in again.');
      }
      
      // Fetch notification preferences
      const response = await fetch(`/tools/shadow-it-scan/api/user/notification-preferences?orgId=${orgId}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to load notification preferences. Please try again.');
      }
      
      const data = await response.json();
      
      // Update state with loaded preferences
      if (data && data.preferences) {
        setNotificationSettings({
          new_app_detected: data.preferences.new_app_detected,
          new_user_in_app: data.preferences.new_user_in_app,
          new_user_in_review_app: data.preferences.new_user_in_review_app
        });
      }
    } catch (err) {
      console.error('Error loading notification preferences:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSettingChange = (setting: keyof NotificationPreferences, value: boolean) => {
    setNotificationSettings(prev => ({
      ...prev,
      [setting]: value
    }));
    
    // Reset success message when user makes a change
    setSaveSuccess(false);
  };

  const handleSaveSettings = async () => {
    try {
      setIsSaving(true);
      setError(null);
      setSaveSuccess(false);
      
      // Read the orgId from cookie or URL parameters
      const orgId = getOrgIdFromCookieOrUrl();
      
      if (!orgId) {
        throw new Error('Organization ID not found');
      }
      
      // Save notification preferences
      const response = await fetch('/tools/shadow-it-scan/api/user/notification-preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          orgId,
          preferences: notificationSettings
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to save notification preferences');
      }
      
      setSaveSuccess(true);
    } catch (err) {
      console.error('Error saving notification preferences:', err);
      setError('Failed to save preferences. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Helper function to get orgId from cookie or URL
  const getOrgIdFromCookieOrUrl = (): string | null => {
    // First try URL parameters
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const urlOrgId = urlParams.get('orgId');
      
      if (urlOrgId) {
        return urlOrgId;
      }
      
      // Then try cookies
      const cookies = document.cookie.split(';');
      const orgIdCookie = cookies.find(cookie => cookie.trim().startsWith('orgId='));
      if (orgIdCookie) {
        return orgIdCookie.split('=')[1].trim();
      }
    }
    
    return null;
  };
  
  // Helper function to get user email from cookie
  const getUserEmailFromCookie = (): string | null => {
    if (typeof window !== 'undefined') {
      const cookies = document.cookie.split(';').map(cookie => cookie.trim());
      const userEmailCookie = cookies.find(cookie => cookie.startsWith('userEmail='));
      
      if (userEmailCookie) {
        try {
          // Decode the cookie value as it might be URL encoded
          return decodeURIComponent(userEmailCookie.split('=')[1]);
        } catch (error) {
          console.error('Error parsing userEmail cookie:', error);
          return null;
        }
      }
    }
    
    return null;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md overflow-hidden">
        <div className="flex justify-between items-center p-6 border-b border-gray-100">
          <h2 className="text-xl font-semibold">Email Notifications</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="hover:bg-gray-100"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center items-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
              <span className="ml-3">Loading settings...</span>
            </div>
          ) : (
            <>
              <h3 className="text-base font-medium text-gray-900">Customize your notification preferences</h3>
              
              {error && (
                <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm">
                  {error}
                </div>
              )}
              
              {saveSuccess && (
                <div className="p-3 bg-green-50 text-green-700 rounded-md text-sm">
                  Settings saved successfully!
                </div>
              )}
              
              <div className="space-y-4">
                {/* New App Detection */}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-medium">New App Detection</Label>
                    <p className="text-sm text-gray-500">Get notified when a new app is detected</p>
                  </div>
                  <div 
                    className="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 cursor-pointer"
                    onClick={() => handleSettingChange('new_app_detected', !notificationSettings.new_app_detected)}
                    style={{ backgroundColor: notificationSettings.new_app_detected ? '#111827' : '#E5E7EB' }}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationSettings.new_app_detected ? 'translate-x-6' : 'translate-x-1'}`} />
                  </div>
                </div>

                {/* New User Notifications */}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-medium">New User Detection</Label>
                    <p className="text-sm text-gray-500">Alert when any new user is added to any app</p>
                  </div>
                  <div 
                    className="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 cursor-pointer"
                    onClick={() => handleSettingChange('new_user_in_app', !notificationSettings.new_user_in_app)}
                    style={{ backgroundColor: notificationSettings.new_user_in_app ? '#111827' : '#E5E7EB' }}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationSettings.new_user_in_app ? 'translate-x-6' : 'translate-x-1'}`} />
                  </div>
                </div>

                {/* Needs Review Apps */}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-medium">Needs Review Apps</Label>
                    <p className="text-sm text-gray-500">Alert when new users are added to apps needing review</p>
                  </div>
                  <div 
                    className="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 cursor-pointer"
                    onClick={() => handleSettingChange('new_user_in_review_app', !notificationSettings.new_user_in_review_app)}
                    style={{ backgroundColor: notificationSettings.new_user_in_review_app ? '#111827' : '#E5E7EB' }}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notificationSettings.new_user_in_review_app ? 'translate-x-6' : 'translate-x-1'}`} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 p-6 border-t border-gray-100">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button 
            onClick={handleSaveSettings} 
            disabled={isLoading || isSaving}
            className={isSaving ? 'opacity-70 cursor-not-allowed' : ''}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
} 