"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { HelpCenter } from "@/components/help/HelpCenter"
import { LovelyLoader } from "@/components/ui/loader"

export default function HelpPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Simulate initial loading
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 500)

    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="min-h-screen cosmic-bg text-foreground">
      {/* Lovely Loader Overlay */}
      {isLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-500">
          <div className="text-center animate-in slide-in-from-bottom-4 duration-700 delay-200">
            <LovelyLoader size="lg" className="mb-4" />
            <p className="text-white text-lg font-medium animate-in slide-in-from-bottom-2 duration-500 delay-300">Loading Help Center...</p>
          </div>
        </div>
      )}

      {/* Purple Circular Home Button */}
      <Link href="/">
        <button
          className="fixed top-6 left-6 z-50 w-14 h-14 bg-purple-600 hover:bg-purple-700 text-white rounded-full flex items-center justify-center shadow-lg transition-all duration-300 hover:scale-110"
          title="Back to Home"
          aria-label="Back to Home"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
      </Link>

      <div className="container mx-auto px-4 py-20">
        <HelpCenter />
      </div>
    </div>
  )
}