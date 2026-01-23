"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  HelpCircle, 
  Search, 
  BookOpen, 
  Video, 
  MessageCircle, 
  ExternalLink,
  Wallet,
  ArrowLeftRight,
  TrendingUp,
  Shield,
  Zap
} from "lucide-react"

interface HelpArticle {
  id: string
  title: string
  description: string
  category: string
  readTime: string
  difficulty: "Beginner" | "Intermediate" | "Advanced"
}

interface VideoTutorial {
  id: string
  title: string
  description: string
  duration: string
  thumbnail: string
  category: string
}

export function HelpCenter() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("all")

  const helpArticles: HelpArticle[] = [
    {
      id: "getting-started",
      title: "Getting Started with EngiPay",
      description: "Learn the basics of connecting your wallet and making your first transaction",
      category: "basics",
      readTime: "5 min",
      difficulty: "Beginner"
    },
    {
      id: "wallet-connection",
      title: "How to Connect Your Wallet",
      description: "Step-by-step guide to connecting MetaMask, Argent, Braavos, and Xverse wallets",
      category: "wallets",
      readTime: "3 min",
      difficulty: "Beginner"
    },
    {
      id: "cross-chain-swaps",
      title: "Cross-Chain Token Swaps",
      description: "Learn how to swap BTC, ETH, and STRK tokens across different blockchains",
      category: "swaps",
      readTime: "7 min",
      difficulty: "Intermediate"
    },
    {
      id: "defi-lending",
      title: "DeFi Lending with Vesu",
      description: "Earn interest by lending your crypto assets through the Vesu protocol",
      category: "defi",
      readTime: "10 min",
      difficulty: "Intermediate"
    },
    {
      id: "staking-rewards",
      title: "Staking STRK Tokens",
      description: "Stake your STRK tokens with Trove protocol to earn rewards",
      category: "defi",
      readTime: "8 min",
      difficulty: "Intermediate"
    },
    {
      id: "yield-farming",
      title: "Yield Farming Strategies",
      description: "Advanced strategies for maximizing yields through liquidity provision",
      category: "defi",
      readTime: "15 min",
      difficulty: "Advanced"
    },
    {
      id: "security-best-practices",
      title: "Security Best Practices",
      description: "Keep your funds safe with these essential security tips",
      category: "security",
      readTime: "12 min",
      difficulty: "Beginner"
    },
    {
      id: "troubleshooting",
      title: "Common Issues & Solutions",
      description: "Troubleshoot common problems and error messages",
      category: "troubleshooting",
      readTime: "6 min",
      difficulty: "Beginner"
    }
  ]

  const videoTutorials: VideoTutorial[] = [
    {
      id: "intro-video",
      title: "EngiPay Introduction",
      description: "Complete overview of EngiPay features and capabilities",
      duration: "5:30",
      thumbnail: "/placeholder-video-thumb.jpg",
      category: "basics"
    },
    {
      id: "wallet-setup",
      title: "Wallet Setup Tutorial",
      description: "Visual guide to setting up and connecting your Web3 wallet",
      duration: "3:45",
      thumbnail: "/placeholder-video-thumb.jpg",
      category: "wallets"
    },
    {
      id: "first-swap",
      title: "Your First Cross-Chain Swap",
      description: "Step-by-step tutorial for making your first token swap",
      duration: "7:20",
      thumbnail: "/placeholder-video-thumb.jpg",
      category: "swaps"
    },
    {
      id: "defi-basics",
      title: "DeFi Basics for Beginners",
      description: "Understanding lending, borrowing, and yield farming",
      duration: "12:15",
      thumbnail: "/placeholder-video-thumb.jpg",
      category: "defi"
    }
  ]

  const categories = [
    { id: "all", name: "All Topics", icon: <BookOpen className="w-4 h-4" /> },
    { id: "basics", name: "Getting Started", icon: <Zap className="w-4 h-4" /> },
    { id: "wallets", name: "Wallets", icon: <Wallet className="w-4 h-4" /> },
    { id: "swaps", name: "Token Swaps", icon: <ArrowLeftRight className="w-4 h-4" /> },
    { id: "defi", name: "DeFi", icon: <TrendingUp className="w-4 h-4" /> },
    { id: "security", name: "Security", icon: <Shield className="w-4 h-4" /> },
    { id: "troubleshooting", name: "Troubleshooting", icon: <HelpCircle className="w-4 h-4" /> }
  ]

  const filteredArticles = helpArticles.filter(article => {
    const matchesSearch = article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         article.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === "all" || article.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  const filteredVideos = videoTutorials.filter(video => {
    const matchesSearch = video.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         video.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === "all" || video.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case "Beginner": return "bg-green-500/20 text-green-400"
      case "Intermediate": return "bg-yellow-500/20 text-yellow-400"
      case "Advanced": return "bg-red-500/20 text-red-400"
      default: return "bg-gray-500/20 text-gray-400"
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-4">
        <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto">
          <HelpCircle className="w-8 h-8 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold mb-2">Help Center</h1>
          <p className="text-muted-foreground">Find answers, tutorials, and guides to help you use EngiPay</p>
        </div>
      </div>

      {/* Search */}
      <Card className="glassmorphism">
        <CardContent className="p-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search for help articles, tutorials, or guides..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 glassmorphism"
            />
          </div>
        </CardContent>
      </Card>

      {/* Categories */}
      <div className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <Button
            key={category.id}
            variant={selectedCategory === category.id ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedCategory(category.id)}
            className="gap-2"
          >
            {category.icon}
            {category.name}
          </Button>
        ))}
      </div>

      {/* Content Tabs */}
      <Tabs defaultValue="articles" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 bg-secondary/50">
          <TabsTrigger value="articles" className="gap-2">
            <BookOpen className="w-4 h-4" />
            Articles
          </TabsTrigger>
          <TabsTrigger value="videos" className="gap-2">
            <Video className="w-4 h-4" />
            Video Tutorials
          </TabsTrigger>
          <TabsTrigger value="contact" className="gap-2">
            <MessageCircle className="w-4 h-4" />
            Contact Support
          </TabsTrigger>
        </TabsList>

        {/* Articles Tab */}
        <TabsContent value="articles" className="space-y-4">
          {filteredArticles.length === 0 ? (
            <Card className="glassmorphism">
              <CardContent className="p-8 text-center">
                <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No articles found matching your search</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {filteredArticles.map((article) => (
                <Card key={article.id} className="glassmorphism hover:scale-105 transition-all duration-300 cursor-pointer">
                  <CardContent className="p-6">
                    <div className="flex justify-between items-start mb-3">
                      <Badge className={getDifficultyColor(article.difficulty)}>
                        {article.difficulty}
                      </Badge>
                      <span className="text-sm text-muted-foreground">{article.readTime}</span>
                    </div>
                    <h3 className="font-semibold mb-2">{article.title}</h3>
                    <p className="text-sm text-muted-foreground mb-4">{article.description}</p>
                    <Button variant="outline" size="sm" className="w-full gap-2">
                      Read Article
                      <ExternalLink className="w-3 h-3" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Videos Tab */}
        <TabsContent value="videos" className="space-y-4">
          {filteredVideos.length === 0 ? (
            <Card className="glassmorphism">
              <CardContent className="p-8 text-center">
                <Video className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No video tutorials found matching your search</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredVideos.map((video) => (
                <Card key={video.id} className="glassmorphism hover:scale-105 transition-all duration-300 cursor-pointer">
                  <CardContent className="p-4">
                    <div className="aspect-video bg-muted rounded-lg mb-3 flex items-center justify-center">
                      <Video className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <div className="flex justify-between items-start mb-2">
                      <Badge variant="secondary">{video.duration}</Badge>
                    </div>
                    <h3 className="font-semibold mb-2 text-sm">{video.title}</h3>
                    <p className="text-xs text-muted-foreground mb-3">{video.description}</p>
                    <Button variant="outline" size="sm" className="w-full gap-2">
                      <Video className="w-3 h-3" />
                      Watch Video
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Contact Support Tab */}
        <TabsContent value="contact" className="space-y-4">
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="glassmorphism">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="w-5 h-5" />
                  Live Chat Support
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">Get instant help from our support team</p>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Response Time:</span>
                    <span className="text-sm text-green-400">~2 minutes</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Availability:</span>
                    <span className="text-sm">24/7</span>
                  </div>
                </div>
                <Button className="w-full gap-2">
                  <MessageCircle className="w-4 h-4" />
                  Start Live Chat
                </Button>
              </CardContent>
            </Card>

            <Card className="glassmorphism">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HelpCircle className="w-5 h-5" />
                  Submit a Ticket
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">Send us a detailed message about your issue</p>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Response Time:</span>
                    <span className="text-sm text-yellow-400">~24 hours</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Best For:</span>
                    <span className="text-sm">Complex Issues</span>
                  </div>
                </div>
                <Button variant="outline" className="w-full gap-2">
                  <ExternalLink className="w-4 h-4" />
                  Submit Ticket
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Community Resources */}
          <Card className="glassmorphism">
            <CardHeader>
              <CardTitle>Community Resources</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="text-center p-4 border border-border rounded-lg">
                  <MessageCircle className="w-8 h-8 text-blue-400 mx-auto mb-2" />
                  <h4 className="font-medium mb-1">Discord Community</h4>
                  <p className="text-sm text-muted-foreground mb-3">Join our active community</p>
                  <Button variant="outline" size="sm">Join Discord</Button>
                </div>
                <div className="text-center p-4 border border-border rounded-lg">
                  <BookOpen className="w-8 h-8 text-green-400 mx-auto mb-2" />
                  <h4 className="font-medium mb-1">Documentation</h4>
                  <p className="text-sm text-muted-foreground mb-3">Technical documentation</p>
                  <Button variant="outline" size="sm">View Docs</Button>
                </div>
                <div className="text-center p-4 border border-border rounded-lg">
                  <Video className="w-8 h-8 text-purple-400 mx-auto mb-2" />
                  <h4 className="font-medium mb-1">YouTube Channel</h4>
                  <p className="text-sm text-muted-foreground mb-3">Video tutorials & updates</p>
                  <Button variant="outline" size="sm">Subscribe</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}