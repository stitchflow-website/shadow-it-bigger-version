"use client";

import React, { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { Button } from "@/components/ui/button";

import { Share2, Link } from "lucide-react";

// SVG components for social media logos

const XLogo = () => (

<svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="currentColor">

<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />

</svg>

);

const LinkedInLogo = () => (

<svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="currentColor">

<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />

</svg>

);

const RedditLogo = () => (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="currentColor">
        <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/>
    </svg>
);

interface ShareProps {

url?: string;

text?: string;

}

export function Share({ url = window.location.href, text = "Check out Renewal Tracker, a free SaaS contract renewal tracking tool from @StitchflowHQ!" }: ShareProps) {

const [showShareSuccess, setShowShareSuccess] = useState(false);

const handleShare = async (platform: string) => {

const shareUrl = url;

const shareText = text;

switch (platform) {

  case 'copy':

    try {

      await navigator.clipboard.writeText("https://renewaltracker.stitchflow.io/");

      setShowShareSuccess(true);

      setTimeout(() => setShowShareSuccess(false), 2000);

    } catch (err) {

      console.error('Failed to copy:', err);

    }

    break;

  case 'twitter':

    // window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`, '_blank');
    window.open(`https://twitter.com/intent/tweet?text=Check%20out%20Renewal%20Tracker%2C%20a%20free%20SaaS%20contract%20renewal%20tracking%20tool%20from%20%40StitchflowHQ%0A%0AOrganize%20SaaS%20contracts%2C%20track%20renewal%20dates%2C%20and%20get%20automated%20alerts%20via%20email%20%26%20calendar%E2%80%94never%20miss%20a%20deadline.%0A%0A%F0%9F%91%89renewaltracker.stitchflow.io%2F%0A%0A&url=`);
    break;

  case 'reddit':

    window.open(`https://www.reddit.com/submit?url=https%3A%2F%2Frenewaltracker.stitchflow.io%2F&title=Check+out+Renewal+Tracker+by+Stitchflow%2C+a+free+tool+for+IT+teams+to+organize+SaaS+contracts%2C+track+renewals+%26+get+auto-reminders&type=LINK`);

    break;

}

};

return (

<Popover>

  <PopoverTrigger asChild>

    <Button 

      variant="outline" 

      className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 px-4 py-2 shadow-sm"

    >

      <Share2 className="h-4 w-4" />

      Share this tool

    </Button>

  </PopoverTrigger>

  <PopoverContent className="w-[290px] p-5" align="end">

    <div className="space-y-4">

      <h3 className="text-sm font-normal">We'd love for you to spread the word!</h3>

      <div className="grid grid-cols-3 gap-2">

        <Button

          variant="outline"

          className="aspect-square h-auto p-3 bg-gray-50 hover:bg-gray-100 border-gray-200 rounded-2xl"

          onClick={() => handleShare('copy')}

        >

          <div className="flex flex-col items-center gap-1.5">

            <Link className="h-5 w-5" />

            <span className="text-xs font-medium">Copy link</span>

          </div>

        </Button>

        <Button

          variant="outline"

          className="aspect-square h-auto p-3 bg-gray-50 hover:bg-gray-100 border-gray-200 rounded-2xl"

          onClick={() => handleShare('twitter')}

        >

          <div className="flex flex-col items-center gap-1.5">

            <XLogo />

            <span className="text-xs font-medium">X</span>

          </div>

        </Button>

        <Button

          variant="outline"

          className="aspect-square h-auto p-3 bg-gray-50 hover:bg-gray-100 border-gray-200 rounded-2xl"

          onClick={() => handleShare('reddit')}

        >

          <div className="flex flex-col items-center gap-1.5">

            <RedditLogo />

            <span className="text-xs font-medium">Reddit</span>

          </div>

        </Button>

      </div>

      {showShareSuccess && (

        <p className="text-sm text-green-600 dark:text-green-400 text-center mt-2">

          Link copied to clipboard!

        </p>

      )}

    </div>

  </PopoverContent>

</Popover>

);

}