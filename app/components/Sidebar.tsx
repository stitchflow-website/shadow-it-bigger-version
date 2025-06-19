import React from 'react';
import Image from 'next/image';
import { 
  Grid3X3, 
  X,
  ChevronLeft,
  ChevronRight,
  BarChart3
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface SidebarProps {
  isOpen: boolean;
  isCollapsed: boolean;
  onToggle: () => void;
  onCollapse: () => void;
  currentView: string;
  onViewChange: (view: string) => void;
}

export default function Sidebar({ 
  isOpen, 
  isCollapsed, 
  onToggle, 
  onCollapse, 
  currentView, 
  onViewChange 
}: SidebarProps) {
  const sidebarWidth = isCollapsed ? 'w-16' : 'w-56';
  const contentVisibility = isCollapsed ? 'hidden' : 'block';

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}
      
      {/* Sidebar */}
      <div className={`
        fixed left-0 top-0 h-full bg-[#F7F5F2] border-r border-[#E0D5C8] z-50
        transition-all duration-300 ease-in-out
        ${isOpen ? sidebarWidth : '-translate-x-full lg:translate-x-0'}
        ${sidebarWidth}
        lg:relative lg:translate-x-0
      `}>
        {/* Header with Logo and User Info */}
        <div className="border-b border-[#E0D5C8] p-4">
          {/* Logo Row */}
          <div className="flex items-center justify-between mb-3">
            <div className={`flex items-center ${contentVisibility}`}>
              <Image 
                src="/images/nav-logo.webp" 
                alt="Stitchflow Logo" 
                width={100} 
                height={24}
                className="h-6 w-auto object-contain"
                priority
              />
            </div>
            
            {/* Collapse/Expand Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onCollapse}
              className="hidden lg:flex p-1 h-7 w-7 hover:bg-[#D4C9B8] transition-colors duration-200"
            >
              {isCollapsed ? (
                <ChevronRight className="h-3 w-3 text-[#7B7481] hover:text-[#363338] transition-colors duration-200" />
              ) : (
                <ChevronLeft className="h-3 w-3 text-[#7B7481] hover:text-[#363338] transition-colors duration-200" />
              )}
            </Button>
            
            {/* Mobile Close Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              className="lg:hidden p-1 h-7 w-7 hover:bg-[#D4C9B8] transition-colors duration-200"
            >
              <X className="h-3 w-3 text-[#7B7481] hover:text-[#363338] transition-colors duration-200" />
            </Button>
          </div>
          
          {/* User Info Row - Only in expanded mode */}
          {!isCollapsed && (
            <div className="flex items-center space-x-2 hover:bg-[#D4C9B8] p-1.5 rounded-md transition-all duration-200 cursor-pointer group">
              <Avatar className="h-6 w-6 flex-shrink-0">
                <AvatarFallback className="bg-[#363338] text-white text-xs font-medium group-hover:bg-[#4A444B] transition-colors duration-200">
                  AP
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="font-medium text-[#363338] group-hover:text-[#1A1A1A] transition-colors duration-200" style={{ fontSize: '12px', lineHeight: '16px' }}>Acme Corp</span>
                <span className="text-[#7B7481] group-hover:text-[#5C5561] transition-colors duration-200" style={{ fontSize: '12px', lineHeight: '16px' }}>Amanda Parker</span>
              </div>
            </div>
          )}
        </div>

        {/* Navigation Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Discover Section */}
          <div>
            <h3 className={`font-semibold text-[#7B7481] mb-3 ${contentVisibility}`} style={{ fontSize: '14px', lineHeight: '18px' }}>
              Discover
            </h3>
            <nav className="space-y-1">
              <button
                onClick={() => onViewChange('applications')}
                className={`
                  w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left
                  transition-all duration-200 ease-in-out
                  group relative
                  ${currentView === 'applications' 
                    ? 'bg-[#363338] text-white shadow-sm' 
                    : 'text-[#363338] hover:bg-[#D4C9B8] hover:shadow-sm hover:translate-y-[-1px]'
                  }
                  ${isCollapsed ? 'justify-center px-2' : 'justify-start'}
                `}
              >
                <Grid3X3 className={`h-4 w-4 flex-shrink-0 transition-colors duration-200 ${
                  currentView === 'applications' 
                    ? 'text-white' 
                    : 'text-[#7B7481] group-hover:text-[#363338]'
                }`} />
                <span className={`font-medium transition-colors duration-200 ${contentVisibility} ${
                  currentView === 'applications'
                    ? 'text-white'
                    : 'group-hover:text-[#1A1A1A]'
                }`} style={{ fontSize: '16px', lineHeight: '20px' }}>
                  Applications
                </span>
              </button>
              
              <button
                onClick={() => onViewChange('ai-risk-analysis')}
                className={`
                  w-full flex items-center space-x-2 px-3 py-2 rounded-md text-left
                  transition-all duration-200 ease-in-out
                  group relative
                  ${currentView === 'ai-risk-analysis' 
                    ? 'bg-[#363338] text-white shadow-sm' 
                    : 'text-[#363338] hover:bg-[#D4C9B8] hover:shadow-sm hover:translate-y-[-1px]'
                  }
                  ${isCollapsed ? 'justify-center px-2' : 'justify-start'}
                `}
              >
                <BarChart3 className={`h-4 w-4 flex-shrink-0 transition-colors duration-200 ${
                  currentView === 'ai-risk-analysis' 
                    ? 'text-white' 
                    : 'text-[#7B7481] group-hover:text-[#363338]'
                }`} />
                <span className={`font-medium transition-colors duration-200 ${contentVisibility} ${
                  currentView === 'ai-risk-analysis'
                    ? 'text-white'
                    : 'group-hover:text-[#1A1A1A]'
                }`} style={{ fontSize: '16px', lineHeight: '20px' }}>
                  AI Risk Analysis
                </span>
              </button>
            </nav>
          </div>
        </div>

        {/* User Section for Collapsed Mode */}
        {isCollapsed && (
          <div className="border-t border-[#E0D5C8] p-4">
            <div className="flex justify-center">
              <Avatar className="h-6 w-6 cursor-pointer hover:opacity-80 hover:scale-105 transition-all duration-200">
                <AvatarFallback className="bg-[#363338] text-white text-xs font-medium hover:bg-[#4A444B] transition-colors duration-200">
                  AP
                </AvatarFallback>
              </Avatar>
            </div>
          </div>
        )}
      </div>
    </>
  );
} 