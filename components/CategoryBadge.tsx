import { useEffect, useState } from 'react';
import { supabaseAdmin } from '@/lib/supabase';

interface CategoryBadgeProps {
  category: string | null;
  applicationId: string;
}

export function CategoryBadge({ category, applicationId }: CategoryBadgeProps) {
  const [isLoading, setIsLoading] = useState(category === 'Unknown' || !category);
  const [currentCategory, setCurrentCategory] = useState<string | null>(category);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    let pollingInterval: NodeJS.Timeout;
    let isMounted = true;

    const checkCategory = async () => {
      try {
        const { data, error } = await supabaseAdmin
          .from('applications')
          .select('category')
          .eq('id', applicationId)
          .single();
        
        if (error) {
          console.error('Error fetching category:', error);
          return;
        }

        if (isMounted && data?.category && data.category !== 'Unknown') {
          setCurrentCategory(data.category);
          setIsLoading(false);
          clearInterval(pollingInterval);
        } else {
          // Increment attempts
          setAttempts(prev => prev + 1);
          
          // Stop polling after 30 attempts (1 minute)
          if (attempts >= 30) {
            clearInterval(pollingInterval);
          }
        }
      } catch (error) {
        console.error('Error in checkCategory:', error);
      }
    };

    if (category === 'Unknown' || !category) {
      // Check immediately
      checkCategory();
      
      // Then poll every 2 seconds
      pollingInterval = setInterval(checkCategory, 2000);

      // Log that polling has started
      console.log('Started polling for category updates');
    }

    return () => {
      isMounted = false;
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [applicationId, category, attempts]);

  const getCategoryColor = (category: string) => {
    const colorMap: { [key: string]: string } = {
      'Analytics & Business Intelligence': 'bg-blue-100 text-blue-800',
      'Cloud Platforms & Infrastructure': 'bg-gray-100 text-gray-800',
      'Customer Success & Support': 'bg-green-100 text-green-800',
      'Design & Creative Tools': 'bg-purple-100 text-purple-800',
      'Developer & Engineering Tools': 'bg-indigo-100 text-indigo-800',
      'Finance & Accounting': 'bg-emerald-100 text-emerald-800',
      'Human Resources & People Management': 'bg-pink-100 text-pink-800',
      'IT Operations & Security': 'bg-red-100 text-red-800',
      'Identity & Access Management': 'bg-yellow-100 text-yellow-800',
      'Productivity & Collaboration': 'bg-blue-100 text-blue-800',
      'Project Management': 'bg-violet-100 text-violet-800',
      'Sales & Marketing': 'bg-orange-100 text-orange-800',
      'Others': 'bg-gray-100 text-gray-800'
    };
    return colorMap[category] || 'bg-gray-100 text-gray-800';
  };

  if (isLoading) {
    return (
      <div className="animate-pulse flex items-center">
        <div className="h-6 w-32 bg-gray-200 rounded-full"></div>
      </div>
    );
  }

  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium ${getCategoryColor(currentCategory || 'Others')}`}>
      {currentCategory || 'Others'}
    </span>
  );
} 