"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { X } from "lucide-react"

// Custom Reddit logo component
const RedditLogo = () => (
  <img src="/reddit-logo.svg" alt="Reddit Logo" width="20" height="20" className="text-orange-500" />
)

export default function SignInDialog() {
  const [open, setOpen] = useState(true)

  const testimonials = [
    {
      text: "Sharing this with my boss. Looks like great potential for our non-existent process haha",
    },
    {
      text: "Nice tool. We're building something similar. The market need is real. Good luck to you <3",
    },
    {
      text: "This is nifty! I'm downloading it now. Do you plan to do updates/keep it current? Definitely going to mention this in my next position.",
    },
    {
      text: "This tool will be a great help to IT admins for sure...!!",
    },
    {
      text: "Quite nifty... there's quite a bit of customizing you can do. Thanks for sharing this for free.",
    },
    {
      text: "Very nice. Wish I had known about this a few months ago. I had our Salesforce admin build a contract tracker with similar functions a couple of months ago and now the finance team wants to use it to track their contracts.",
    },
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[900px] md:max-w-[1000px] p-0 overflow-hidden font-inter">
        <div className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
          {/* Left side - Sign in */}
          <div className="space-y-8 p-8">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">Sign in to continue</h2>
              <p className="text-sm text-muted-foreground">
                Ensure you connect your admin org account to get started with the app
              </p>
            </div>
            <div className="space-y-6">
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => {}}>
                <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Sign in with Google Workspace
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2" onClick={() => {}}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 23 23">
                  <path fill="#f3f3f3" d="M0 0h23v23H0z" />
                  <path fill="#f35325" d="M1 1h10v10H1z" />
                  <path fill="#81bc06" d="M12 1h10v10H12z" />
                  <path fill="#05a6f0" d="M1 12h10v10H1z" />
                  <path fill="#ffba08" d="M12 12h10v10H12z" />
                </svg>
                Sign in with Microsoft Entra ID
              </Button>
            </div>

            <div className="space-y-3 pt-6">
              <div className="text-sm text-muted-foreground">
                <p>Stitchflow's IT tools meet the highest industry standards for security, privacy, and compliance.</p>
                <p className="mt-2">
                  <a href="https://www.stitchflow.com/security" className="font-medium text-green-600 hover:underline">
                    View our security terms
                  </a>{" "}
                  or{" "}
                  <a href="https://www.stitchflow.com/demo" className="font-medium text-green-600 hover:underline">
                    schedule a chat
                  </a>{" "}
                  with us to discuss if your org has specific security policies for using external tools.
                </p>
              </div>
            </div>
          </div>

          {/* Right side - Reddit testimonials */}
          <div className="hidden space-y-4 bg-gray-50 p-8 md:block">
            <h3 className="text-center text-lg font-semibold">What IT folks share about our free tools</h3>
            <div className="max-h-[400px] space-y-4 overflow-y-auto pr-2">
              {testimonials.map((testimonial, index) => (
                <div key={index} className="rounded-md bg-[#f5f0e8] p-4">
                  <div className="flex items-start gap-2">
                    <RedditLogo />
                    <div>
                      <div className="mb-1 text-xs font-medium">r/user</div>
                      <p className="text-sm">{testimonial.text}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
