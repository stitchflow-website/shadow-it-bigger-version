"use client";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import React from "react";
export function WhyStitchflow({ className }: { className?: string }) {
  return (
    <section className={cn("text-black py-12", className)}>
      <div className="container mx-auto w-full px-4">
        <div className="flex flex-col items-center text-center max-w-4xl mx-auto bg-white rounded-xl shadow-md border border-gray-100 p-8">
          <h2 className="text-3xl md:text-3xl font-bold tracking-tight mb-4">
          Good “SaaS management” eliminates the need for Shadow IT
          </h2>
          
          <p className="text-[15px] text-muted-foreground max-w-2xl mx-auto mb-8 text-wrap">
          Go beyond a list of apps, actually reconcile data that matters. Stitchflow adapts to your company's unique structure, policies, and exceptions, continuously syncs data from every tool in your environment, and provides on-demand insights for app audits, access reviews, license renewals, and offboarding
          </p>
          <div className="w-full mb-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mx-auto">
              <div className="flex items-start gap-3">
                <Check className="w-4 h-4 mt-1 text-emerald-500 shrink-0" />
                <p className="text-left text-sm font-400 text-black">Instant SaaS user data reconciliation against your sources of truth</p>
              </div>
              <div className="flex items-start gap-3">
                <Check className="w-4 h-4 mt-1 text-emerald-500 shrink-0" />
                <p className="text-left text-sm font-400 text-black">Precise visibility into only the accounts that need attention</p>
              </div>
              <div className="flex items-start gap-3">
                <Check className="w-4 h-4 mt-1 text-emerald-500 shrink-0" />
                <p className="text-left text-sm font-400 text-black">Automated remediation of cost, security and compliance gaps</p>
              </div>
            </div>
          </div>
          <a 
            href="https://www.stitchflow.com/schedule-a-demo?utm_source=Shadow_IT&utm_medium=Shadow_IT_CTA"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-black text-white hover:bg-zinc-900 px-6 py-2 rounded-full text-sm font-medium transition-colors"
          >
            Schedule a Demo
          </a>
        </div>
      </div>
    </section>
  );
} 