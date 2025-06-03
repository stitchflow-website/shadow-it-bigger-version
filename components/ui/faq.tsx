"use client";

import React from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export function FAQ() {
  return (
    <div className="bg-[#f8f5f3]">
      <div className="max-w-[900px] mx-auto pt-11 px-6 pb-11">
        <div className="text-center mb-11">
          <h2 className="text-2xl font-semibold">Frequently Asked Questions</h2>
        </div>

      <Accordion type="single" collapsible className="w-full space-y-6 mt-11">

        {/* <AccordionItem value="item-1" className="border rounded-lg border-gray-200 bg-white">
            <AccordionTrigger className="text-left hover:no-underline hover:bg-gray-50 px-6 py-4 transition-colors w-full">
              <div className="flex-1 text-base font-medium">
              Is it really free?
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="text-gray-600 space-y-4">
                <p className="text-sm leading-relaxed">
                Yes, totally! Get started by scanning your Google or Microsoft workspace. No hidden costs, just clear insights.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem> */}


          <AccordionItem value="item-2" className="border rounded-lg border-gray-200 bg-white">
            <AccordionTrigger className="text-left hover:no-underline hover:bg-gray-50 px-6 py-4 transition-colors w-full">
              <div className="flex-1 text-base font-medium">
              What is Shadow IT, and why should I be concerned?
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="text-gray-600 space-y-4">
                <p className="text-sm leading-relaxed">
                Shadow IT refers to software apps used by employees without explicit oversight from IT. While employees often turn to these tools to get their work done faster, the problem arises when these apps operate outside IT's visibility.
                The real concern? Unseen risks and inefficiencies. Apps with excessive permissions, unmanaged user growth, or outdated access can lead to data breaches, compliance gaps, and wasted resources. Instead of chasing every small tool, you need visibility where it matters—spotting real risks before they escalate.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="item-3" className="border rounded-lg border-gray-200 bg-white">
            <AccordionTrigger className="text-left hover:no-underline hover:bg-gray-50 px-6 py-4 transition-colors w-full">
              <div className="flex-1 text-base font-medium">
              What specific data can the scanner access?
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="text-gray-600 space-y-4">
                <p className="text-sm leading-relaxed">
                With a quick one-time setup (for example, connecting to your Google Workspace or Microsoft 365 admin accounts), the scanner identifies all third-party applications that your employees have authorized. It then analyzes each app's OAuth scopes (permissions granted) and how many users are using each app, and then provides a detailed insight for your org. 
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="item-4" className="border rounded-lg border-gray-200 bg-white">
            <AccordionTrigger className="text-left hover:no-underline hover:bg-gray-50 px-6 py-4 transition-colors w-full">
              <div className="flex-1 text-base font-medium">
              How are apps categorized by risk level?
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="text-gray-600 space-y-4">
                <p className="text-sm leading-relaxed">
                The scanner evaluates OAuth scopes granted per user per app, then categorizing apps as Low, Medium, or High Risk. Risks are based on data access permissions, usage patterns, and scope variations across user groups.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="item-5" className="border rounded-lg border-gray-200 bg-white">
            <AccordionTrigger className="text-left hover:no-underline hover:bg-gray-50 px-6 py-4 transition-colors w-full">
              <div className="flex-1 text-base font-medium">
              Can I receive notifications when new apps are detected?
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 pt-4">
              <div className="text-gray-600 space-y-4">
                <p className="text-sm leading-relaxed">
                Yes, you'll receive automated alerts whenever a new app or user is detected. You can also set up email alerts for when risky apps gain new users.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="item-6" className="border rounded-lg border-gray-200 bg-white">
            <AccordionTrigger className="text-left hover:no-underline hover:bg-gray-50 px-6 py-4 transition-colors w-full">
              <div className="flex-1 text-base font-medium">
              What if there are more apps that my org uses but not scanned here?
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="text-gray-600 space-y-4">
                <p className="text-sm leading-relaxed">
                Our scanner reads only OAuth-based access—so anytime your employees use "Sign in with Google" or "Sign in with Microsoft" to access apps, those apps will be listed here.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="item-7" className="border rounded-lg border-gray-200 bg-white">
            <AccordionTrigger className="text-left hover:no-underline hover:bg-gray-50 px-6 py-4 transition-colors w-full">
              <div className="flex-1 text-base font-medium">
              How do you handle data security?
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="text-gray-600 space-y-4">
                <p className="text-sm leading-relaxed">
                The Shadow IT Scanner uses limited scope access to gather data as security is our top priority. We do not collect or store any sensitive content beyond what's necessary to provide the service. As a part of Stitchflow, the tool adheres with the platform-wide <a href="https://www.stitchflow.com/security" className="text-blue-500 hover:underline">security terms</a>
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="item-8" className="border rounded-lg border-gray-200 bg-white">
            <AccordionTrigger className="text-left hover:no-underline hover:bg-gray-50 px-6 py-4 transition-colors w-full">
              <div className="flex-1 text-base font-medium">
              How's the Stitchflow Shadow IT Scanner different?
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="text-gray-600 space-y-4">
                <p className="text-sm leading-relaxed">
                Most free scanners offer just a basic list of apps and users—with limited or no insights, especially for Microsoft (Entra). Stitchflow goes deeper. You get granular user-level scope analysis, risk scoring, and visual dashboards across both Google and Microsoft workspaces. With continuous scanning and real-time alerts, you'll catch outliers and new apps as they appear—making Shadow IT manageable, not mysterious.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
}
