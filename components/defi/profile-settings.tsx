"use client"

import type React from "react"

import { useState, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { User, Shield, Globe, Bell, Palette, Smartphone, Upload, Camera } from "lucide-react"
import { useWallet } from "@/contexts/WalletContext"

export function ProfileSettings() {
  const { walletAddress } = useWallet()
  const [notifications, setNotifications] = useState({
    rewards: true,
    positions: true,
    security: true,
    marketing: false,
  })

  const [profileImage, setProfileImage] = useState("/web3-avatar.jpg")
  const [displayName, setDisplayName] = useState("")
  const [ensName, setEnsName] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        setProfileImage(e.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-balance">Profile & Settings</h2>
          <p className="text-muted-foreground">Manage your account and preferences</p>
        </div>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5 bg-secondary/50">
          <TabsTrigger
            value="profile"
            className="cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:bg-primary/10 transition-all"
          >
            Profile
          </TabsTrigger>
          <TabsTrigger
            value="security"
            className="cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:bg-primary/10 transition-all"
          >
            Security
          </TabsTrigger>
          <TabsTrigger
            value="network"
            className="cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:bg-primary/10 transition-all"
          >
            Network
          </TabsTrigger>
          <TabsTrigger
            value="appearance"
            className="cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:bg-primary/10 transition-all"
          >
            Theme
          </TabsTrigger>
          <TabsTrigger
            value="notifications"
            className="cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:bg-primary/10 transition-all"
          >
            Alerts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <Card className="gradient-card hover:glow-effect transition-all">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Profile Information
              </CardTitle>
              <CardDescription>Your identity and display preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Avatar Section */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                <div className="relative">
                  <Avatar className="h-20 w-20">
                    <AvatarImage src={profileImage || "/placeholder.svg"} />
                    <AvatarFallback className="text-lg">EN</AvatarFallback>
                  </Avatar>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full p-0 cursor-pointer hover:bg-primary/20 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </div>
                <div className="space-y-2 flex-1">
                  <div>
                    <Label className="text-sm font-medium">Profile Picture</Label>
                    <p className="text-sm text-muted-foreground">NFT avatar or custom image</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="cursor-pointer hover:bg-primary/10 transition-colors bg-transparent"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Upload Image
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="cursor-pointer hover:bg-primary/10 transition-colors bg-transparent"
                    >
                      Connect NFT
                    </Button>
                  </div>
                </div>
              </div>

              {/* ENS/Username */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ens">ENS Name</Label>
                  <div className="flex gap-2">
                    <Input
                      id="ens"
                      placeholder="yourname.eth"
                      value={ensName}
                      onChange={(e) => setEnsName(e.target.value)}
                      className="hover:border-primary/50 transition-colors"
                    />
                    <Button
                      variant="outline"
                      className="cursor-pointer hover:bg-primary/10 transition-colors bg-transparent"
                    >
                      Verify
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">Display Name</Label>
                  <Input
                    id="username"
                    placeholder="Your display name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="hover:border-primary/50 transition-colors"
                  />
                </div>
              </div>

              {/* Wallet Address */}
              <div className="space-y-2">
                <Label>Connected Wallet</Label>
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                      <span className="text-xs font-bold text-primary">0x</span>
                    </div>
                    <div>
                      <div className="font-mono text-sm">{walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'Not connected'}</div>
                      <div className="text-xs text-muted-foreground">Primary wallet</div>
                    </div>
                  </div>
                  <Badge variant="secondary" className="bg-primary/10 text-primary">
                    Connected
                  </Badge>
                </div>
              </div>

              <Button className="w-full md:w-auto cursor-pointer hover:bg-primary/90 transition-colors">
                Save Profile
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card className="gradient-card hover:glow-effect transition-all">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Security Settings
              </CardTitle>
              <CardDescription>Protect your account and assets</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Two-Factor Authentication */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors">
                <div>
                  <div className="font-medium">Two-Factor Authentication</div>
                  <div className="text-sm text-muted-foreground">Add an extra layer of security</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-destructive border-destructive">
                    Disabled
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="cursor-pointer hover:bg-primary/10 transition-colors bg-transparent"
                  >
                    Enable
                  </Button>
                </div>
              </div>

              {/* Hardware Wallet */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors">
                <div>
                  <div className="font-medium">Hardware Wallet</div>
                  <div className="text-sm text-muted-foreground">Connect Ledger or Trezor</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="bg-primary/10 text-primary">
                    Connected
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="cursor-pointer hover:bg-primary/10 transition-colors bg-transparent"
                  >
                    Manage
                  </Button>
                </div>
              </div>

              {/* Session Management */}
              <div className="space-y-3">
                <Label>Active Sessions</Label>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors cursor-pointer">
                    <div className="flex items-center gap-3">
                      <Smartphone className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-medium">Current Session</div>
                        <div className="text-xs text-muted-foreground">Chrome on macOS • Active now</div>
                      </div>
                    </div>
                    <Badge variant="secondary" className="bg-primary/10 text-primary">
                      Current
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Transaction Signing */}
              <div className="space-y-3">
                <Label>Transaction Signing</Label>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors">
                    <div>
                      <div className="text-sm font-medium">Require confirmation for large transactions</div>
                      <div className="text-xs text-muted-foreground">Transactions over $1,000</div>
                    </div>
                    <Switch defaultChecked className="cursor-pointer" />
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors">
                    <div>
                      <div className="text-sm font-medium">Auto-approve small transactions</div>
                      <div className="text-xs text-muted-foreground">Under $100</div>
                    </div>
                    <Switch className="cursor-pointer" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="network" className="space-y-6">
          <Card className="gradient-card hover:glow-effect transition-all">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Network Settings
              </CardTitle>
              <CardDescription>Configure blockchain networks and RPC endpoints</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Default Network */}
              <div className="space-y-2">
                <Label htmlFor="default-network">Default Network</Label>
                <Select defaultValue="starknet">
                  <SelectTrigger className="cursor-pointer hover:bg-secondary/50 transition-colors">
                    <SelectValue placeholder="Select default network" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starknet" className="cursor-pointer">
                      Starknet Mainnet
                    </SelectItem>
                    <SelectItem value="ethereum" className="cursor-pointer">
                      Ethereum Mainnet
                    </SelectItem>
                    <SelectItem value="polygon" className="cursor-pointer">
                      Polygon
                    </SelectItem>
                    <SelectItem value="arbitrum" className="cursor-pointer">
                      Arbitrum One
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Network List */}
              <div className="space-y-3">
                <Label>Enabled Networks</Label>
                <div className="space-y-2">
                  {[
                    {
                      name: "Starknet Mainnet",
                      status: "Connected",
                      rpc: "https://starknet-mainnet.public.blastapi.io",
                    },
                    { name: "Ethereum Mainnet", status: "Connected", rpc: "https://eth-mainnet.alchemyapi.io" },
                    { name: "Polygon", status: "Disabled", rpc: "https://polygon-rpc.com" },
                    { name: "Arbitrum One", status: "Connected", rpc: "https://arb1.arbitrum.io/rpc" },
                  ].map((network) => (
                    <div
                      key={network.name}
                      className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors cursor-pointer"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{network.name}</div>
                        <div className="text-xs text-muted-foreground font-mono truncate">{network.rpc}</div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <Badge
                          variant={network.status === "Connected" ? "secondary" : "outline"}
                          className={network.status === "Connected" ? "bg-primary/10 text-primary" : ""}
                        >
                          {network.status}
                        </Badge>
                        <Switch defaultChecked={network.status === "Connected"} className="cursor-pointer" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Custom RPC */}
              <div className="space-y-2">
                <Label htmlFor="custom-rpc">Add Custom RPC</Label>
                <div className="flex gap-2">
                  <Input
                    id="custom-rpc"
                    placeholder="https://your-rpc-endpoint.com"
                    className="hover:border-primary/50 transition-colors"
                  />
                  <Button
                    variant="outline"
                    className="cursor-pointer hover:bg-primary/10 transition-colors bg-transparent"
                  >
                    Add
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance" className="space-y-6">
          <Card className="gradient-card hover:glow-effect transition-all">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5" />
                Appearance & Language
              </CardTitle>
              <CardDescription>Customize your interface preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Theme Selection */}
              <div className="space-y-3">
                <Label>Theme</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg border-2 border-primary bg-secondary/50 cursor-pointer hover:bg-secondary/70 transition-colors">
                    <div className="text-sm font-medium">Dark</div>
                    <div className="text-xs text-muted-foreground">Current theme</div>
                  </div>
                  <div className="p-3 rounded-lg border border-border bg-secondary/50 cursor-pointer hover:border-primary/50 hover:bg-secondary/70 transition-all">
                    <div className="text-sm font-medium">Light</div>
                    <div className="text-xs text-muted-foreground">Coming soon</div>
                  </div>
                  <div className="p-3 rounded-lg border border-border bg-secondary/50 cursor-pointer hover:border-primary/50 hover:bg-secondary/70 transition-all">
                    <div className="text-sm font-medium">Auto</div>
                    <div className="text-xs text-muted-foreground">System preference</div>
                  </div>
                </div>
              </div>

              {/* Language */}
              <div className="space-y-2">
                <Label htmlFor="language">Language</Label>
                <Select defaultValue="en">
                  <SelectTrigger className="cursor-pointer hover:bg-secondary/50 transition-colors">
                    <SelectValue placeholder="Select language" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en" className="cursor-pointer">
                      English
                    </SelectItem>
                    <SelectItem value="es" className="cursor-pointer">
                      Español
                    </SelectItem>
                    <SelectItem value="fr" className="cursor-pointer">
                      Français
                    </SelectItem>
                    <SelectItem value="de" className="cursor-pointer">
                      Deutsch
                    </SelectItem>
                    <SelectItem value="zh" className="cursor-pointer">
                      中文
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Currency */}
              <div className="space-y-2">
                <Label htmlFor="currency">Display Currency</Label>
                <Select defaultValue="usd">
                  <SelectTrigger className="cursor-pointer hover:bg-secondary/50 transition-colors">
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="usd" className="cursor-pointer">
                      USD ($)
                    </SelectItem>
                    <SelectItem value="eur" className="cursor-pointer">
                      EUR (€)
                    </SelectItem>
                    <SelectItem value="gbp" className="cursor-pointer">
                      GBP (£)
                    </SelectItem>
                    <SelectItem value="eth" className="cursor-pointer">
                      ETH (Ξ)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Options for Interface */}
              <div className="space-y-3">
                <Label>Interface Options</Label>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors">
                    <div>
                      <div className="text-sm font-medium">Compact mode</div>
                      <div className="text-xs text-muted-foreground">Reduce spacing and padding</div>
                    </div>
                    <Switch className="cursor-pointer" />
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors">
                    <div>
                      <div className="text-sm font-medium">Show advanced features</div>
                      <div className="text-xs text-muted-foreground">Display technical details</div>
                    </div>
                    <Switch defaultChecked className="cursor-pointer" />
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors">
                    <div>
                      <div className="text-sm font-medium">Animation effects</div>
                      <div className="text-xs text-muted-foreground">Enable smooth transitions</div>
                    </div>
                    <Switch defaultChecked className="cursor-pointer" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <Card className="gradient-card hover:glow-effect transition-all">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Notification Settings
              </CardTitle>
              <CardDescription>Control when and how you receive alerts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Notification Types */}
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors">
                  <div>
                    <div className="font-medium">Reward notifications</div>
                    <div className="text-sm text-muted-foreground">When rewards are ready to claim</div>
                  </div>
                  <Switch
                    checked={notifications.rewards}
                    onCheckedChange={(checked) => setNotifications((prev) => ({ ...prev, rewards: checked }))}
                    className="cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors">
                  <div>
                    <div className="font-medium">Position alerts</div>
                    <div className="text-sm text-muted-foreground">Health factor and liquidation warnings</div>
                  </div>
                  <Switch
                    checked={notifications.positions}
                    onCheckedChange={(checked) => setNotifications((prev) => ({ ...prev, positions: checked }))}
                    className="cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors">
                  <div>
                    <div className="font-medium">Security alerts</div>
                    <div className="text-sm text-muted-foreground">Login attempts and security events</div>
                  </div>
                  <Switch
                    checked={notifications.security}
                    onCheckedChange={(checked) => setNotifications((prev) => ({ ...prev, security: checked }))}
                    className="cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors">
                  <div>
                    <div className="font-medium">Marketing updates</div>
                    <div className="text-sm text-muted-foreground">New features and promotions</div>
                  </div>
                  <Switch
                    checked={notifications.marketing}
                    onCheckedChange={(checked) => setNotifications((prev) => ({ ...prev, marketing: checked }))}
                    className="cursor-pointer"
                  />
                </div>
              </div>

              {/* Method of Delivery */}
              <div className="space-y-3">
                <Label>Delivery Methods</Label>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors">
                    <div>
                      <div className="font-medium">Browser notifications</div>
                      <div className="text-sm text-muted-foreground">Real-time alerts in your browser</div>
                    </div>
                    <Switch defaultChecked className="cursor-pointer" />
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border hover:bg-secondary/70 transition-colors">
                    <div>
                      <div className="font-medium">Email notifications</div>
                      <div className="text-sm text-muted-foreground">user@example.com</div>
                    </div>
                    <Switch className="cursor-pointer" />
                  </div>
                </div>
              </div>

              <Button className="w-full md:w-auto cursor-pointer hover:bg-primary/90 transition-colors">
                Save Preferences
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
