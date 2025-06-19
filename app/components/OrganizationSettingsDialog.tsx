import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings } from "lucide-react";

// --- TYPE DEFINITIONS ---

interface BucketWeights {
    dataPrivacy: number;
    securityAccess: number;
    businessImpact: number;
    aiGovernance: number;
    vendorProfile: number;
}

interface MultiplierCategory {
    dataPrivacy: number;
    securityAccess: number;
    businessImpact: number;
    aiGovernance: number;
    vendorProfile: number;
}

interface OrgSettings {
    bucketWeights: BucketWeights;
    aiMultipliers: {
        native: MultiplierCategory;
        partial: MultiplierCategory;
        none: MultiplierCategory;
    };
    scopeMultipliers: {
        high: MultiplierCategory;
        medium: MultiplierCategory;
        low: MultiplierCategory;
    };
}

interface OrganizationSettingsDialogProps {
  initialSettings: OrgSettings;
  onSave: (newSettings: OrgSettings) => void;
}

// --- MAIN COMPONENT ---

export const OrganizationSettingsDialog: React.FC<OrganizationSettingsDialogProps> = ({ initialSettings, onSave }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [tempSettings, setTempSettings] = useState(initialSettings);

  // When the dialog is opened, reset tempSettings to match the initial ones
  useEffect(() => {
    if (isOpen) {
      setTempSettings(initialSettings);
    }
  }, [isOpen, initialSettings]);

  const handleSave = () => {
    const totalWeight = Object.values(tempSettings.bucketWeights).reduce((sum, weight) => sum + weight, 0);
    if (totalWeight === 100) {
      onSave(tempSettings);
      setIsOpen(false);
    } else {
      // This case is handled by disabling the button, but as a safeguard:
      alert("Total weight must be 100%.");
    }
  };
  
  const totalWeight = Object.values(tempSettings.bucketWeights).reduce((sum, weight) => sum + weight, 0);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings className="h-4 w-4 mr-2" />
          Organization Score Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col p-4">
        <DialogHeader className="flex-shrink-0 mb-4">
          <DialogTitle>Organization Score Settings</DialogTitle>
          <DialogDescription>
            Customize scoring weights and multipliers for your organization's risk assessment methodology.
          </DialogDescription>
          <div className="mt-3 p-2 bg-blue-50 border-l-4 border-blue-400 rounded">
            <p className="text-sm text-blue-700">
              <span className="font-medium">Note:</span> Any changes to these settings will update risk scores across the application.
            </p>
          </div>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto space-y-5 px-2">
          {/* Bucket Weights Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold ml-1">Category Weights</h3>
            <p className="text-sm text-gray-600 ml-1">Adjust the importance of each risk category. Total must equal 100%.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(tempSettings.bucketWeights).map(([key, value]) => (
                <div className="space-y-1" key={key}>
                  <Label htmlFor={key} className="text-sm font-medium capitalize">{key.replace(/([A-Z])/g, ' $1')}</Label>
                  <div className="flex items-center space-x-2">
                    <Input
                      id={key}
                      type="number"
                      min="0"
                      max="100"
                      value={value}
                      onChange={(e) => setTempSettings(prev => ({
                        ...prev,
                        bucketWeights: { ...prev.bucketWeights, [key]: Number(e.target.value) }
                      }))}
                      className="w-20 h-9 text-sm px-3 text-center"
                    />
                    <span className="text-sm text-gray-500">%</span>
                  </div>
                </div>
              ))}
            </div>
             {totalWeight !== 100 ? (
                <div className="p-3 bg-red-50 border border-red-200 rounded">
                    <p className="text-sm text-red-700">⚠️ Total weight is {totalWeight}%. Must equal 100% to save.</p>
                </div>
                ) : (
                <div className="p-3 bg-green-50 border border-green-200 rounded">
                    <p className="text-sm text-green-700">✅ Total weight: {totalWeight}%</p>
                </div>
            )}
          </div>
          
          {/* AI Multipliers Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold ml-1">GenAI Risk Multipliers</h3>
            <p className="text-sm text-gray-600 ml-1">Adjust risk multipliers based on GenAI's impact on an app.</p>
            {Object.entries(tempSettings.aiMultipliers).map(([level, multipliers]) => (
              <div key={level} className="space-y-3">
                <h4 className="text-base font-medium text-gray-900 ml-1 capitalize">{level}</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                  {Object.entries(multipliers).map(([cat, val]) => (
                    <div className="space-y-1" key={cat}>
                      <Label className="text-sm capitalize">{cat.replace(/([A-Z])/g, ' $1')}</Label>
                      <Input
                        type="number"
                        step="0.05"
                        min="1.0"
                        max="3.0"
                        value={val}
                        onChange={(e) => setTempSettings(prev => ({
                          ...prev,
                          aiMultipliers: { ...prev.aiMultipliers, [level]: { ...prev.aiMultipliers[level as keyof typeof prev.aiMultipliers], [cat]: Number(e.target.value) } }
                        }))}
                        className="h-9 text-sm px-3 text-center"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          
          {/* Scope Risk Multipliers Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold ml-1">Scope Risk Multipliers</h3>
            <p className="text-sm text-gray-600 ml-1">Adjust risk multipliers based on an application's scope permissions.</p>
             {Object.entries(tempSettings.scopeMultipliers).map(([level, multipliers]) => (
              <div key={level} className="space-y-3">
                <h4 className="text-base font-medium text-gray-900 ml-1 capitalize">{level}</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                  {Object.entries(multipliers).map(([cat, val]) => (
                    <div className="space-y-1" key={cat}>
                      <Label className="text-sm capitalize">{cat.replace(/([A-Z])/g, ' $1')}</Label>
                      <Input
                        type="number"
                        step="0.05"
                        min="1.0"
                        max="3.0"
                        value={val}
                        onChange={(e) => setTempSettings(prev => ({
                          ...prev,
                          scopeMultipliers: { ...prev.scopeMultipliers, [level]: { ...prev.scopeMultipliers[level as keyof typeof prev.scopeMultipliers], [cat]: Number(e.target.value) } }
                        }))}
                        className="w-full h-9 text-sm px-3 text-center"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="flex justify-end space-x-2 pt-3 px-2 border-t bg-white flex-shrink-0">
          <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={totalWeight !== 100}>Save Settings</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}; 