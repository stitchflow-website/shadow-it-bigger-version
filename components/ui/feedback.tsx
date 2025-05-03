"use client";

import React, { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { Button } from "@/components/ui/button";

import { MessageSquare, X } from "lucide-react";

import { cn } from "@/lib/utils";

export function FeedbackChat() {

const [isOpen, setIsOpen] = useState(false);

return (

<Popover open={isOpen} onOpenChange={setIsOpen}>

  <PopoverTrigger asChild>

    <Button

      className={cn(

        "fixed bottom-14 right-6 h-14 w-14 rounded-full shadow-lg p-0 z-50",

        "bg-primary hover:bg-primary/90 text-white",

        isOpen && "bg-primary/90"

      )}

    >

      <MessageSquare className="h-6 w-6" />

    </Button>

  </PopoverTrigger>

  <PopoverContent

    className="w-[300px] p-4 mr-4"

    align="end"

    side="top"

    sideOffset={20}

  >

    <div className="space-y-4">

      <div className="flex items-center justify-between">

        <h3 className="font-medium">We'd love to hear from you</h3>

        <Button

          variant="ghost"

          size="sm"

          className="h-8 w-8 p-0"

          onClick={() => setIsOpen(false)}

        >

          <X className="h-4 w-4" />

        </Button>

      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400">

      If you'd like us to add anything to the Shadow IT Scanner or build something new, drop us your thoughts at{" "}

        <a

          href="mailto:contact@stitchflow.io"

          className="text-primary hover:underline"

        >

        contact@stitchflow.io

        </a>

      </p>

    </div>

  </PopoverContent>

</Popover>

);

}