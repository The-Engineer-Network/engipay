# EngiPay - Next-Gen Web3 Payments & DeFi Super App

![EngiPay Logo](public/placeholder-logo.png)

A revolutionary Web3 super app that combines everyday payments with powerful DeFi tools, built on StarkNet for maximum security and scalability.

## 🚀 Features

- **⚡ Instant Payments**: P2P & Merchant payments powered by Chipi-Pay SDK
- **🔄 Cross-Chain Swaps**: Seamless BTC ↔ STRK/ETH via Atomiq SDK
- **₿ Bitcoin Ready**: Direct Bitcoin integration via Xverse Wallet API
- **💰 DeFi Power Tools**: Lending, borrowing, yield farming, and staking
- **📊 Real Wallet Balances**: Live display of actual ETH, USDT, and USDC balances
- **🔗 Seamless Navigation**: Easy access between dashboard and DeFi features
- **🔌 Wallet Management**: Connect/disconnect wallets with persistent sessions
- **🏠 Seamless Navigation**: Easy switching between home page and dashboard when logged in
- **🔒 Enterprise Security**: Built on StarkNet's zero-knowledge rollup technology
- **📱 Mobile-First**: Responsive design with smooth animations

## 🛠️ Tech Stack

### Frontend Framework
- **Next.js 15.5.3** - React framework with App Router
- **React 18** - UI library
- **TypeScript** - Type-safe JavaScript

### Styling & UI
- **Tailwind CSS 4.1.9** - Utility-first CSS framework
- **Tailwind Animate** - Animation utilities
- **Geist Font** - Modern typography
- **Radix UI** - Accessible component primitives
- **Lucide React** - Beautiful icons

### Development Tools
- **ESLint** - Code linting
- **PostCSS** - CSS processing
- **Autoprefixer** - CSS vendor prefixing

### Key Dependencies
- **@vercel/analytics** - Web analytics
- **class-variance-authority** - Component variant utilities
- **clsx** - Conditional CSS classes
- **tailwind-merge** - Tailwind class merging

## 📁 Project Structure

```
engipay/
├── app/                          # Next.js App Router
│   ├── about/                    # About page
│   │   └── page.tsx
│   ├── dashboard/                # Main dashboard
│   │   └── page.tsx
│   ├── defi/                     # DeFi management page
│   │   └── page.tsx
│   ├── faq/                      # FAQ page
│   │   └── page.tsx
│   ├── features/                 # Features page
│   │   └── page.tsx
│   ├── profile-page/             # User profile page
│   │   └── page.tsx
│   ├── technology/               # Technology page
│   │   └── page.tsx
│   ├── globals.css               # Global styles
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Landing page
├── components/                   # Reusable components
│   ├── ui/                       # UI components (shadcn/ui)
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── loader.tsx           # Custom loader components
│   │   └── ...
│   ├── dashboard/                # Dashboard components
│   │   ├── DashboardHeader.tsx
│   │   ├── DashboardNavigation.tsx
│   │   └── ...
│   ├── defi/                     # DeFi components
│   │   ├── portfolio-overview.tsx
│   │   ├── yield-farming.tsx
│   │   ├── lending-borrowing.tsx
│   │   ├── claim-rewards.tsx
│   │   └── profile-settings.tsx
│   ├── theme-provider.tsx       # Theme provider
│   └── WalletConnectModal.tsx   # Wallet connection modal
├── hooks/                        # Custom React hooks
│   ├── use-mobile.ts
│   └── use-toast.ts
├── lib/                          # Utility libraries
│   └── utils.ts                  # Utility functions
├── public/                       # Static assets
│   ├── placeholder-logo.png
│   ├── placeholder-logo.svg
│   └── ...
├── styles/                       # Additional styles
│   └── globals.css
├── next.config.mjs              # Next.js configuration
├── package.json                 # Dependencies & scripts
├── tailwind.config.js           # Tailwind configuration
├── tsconfig.json                # TypeScript configuration
└── README.md                    # This file
```

## 🏗️ Architecture Overview

### App Router Structure
- **File-based routing** with Next.js 13+ App Router
- **Server Components** for optimal performance
- **Client Components** for interactivity (marked with "use client")

### Component Architecture
- **Atomic Design**: Small, reusable components
- **shadcn/ui**: High-quality, accessible UI components
- **Custom Components**: Project-specific components in `/components`

### Styling Approach
- **Tailwind CSS**: Utility-first styling
- **CSS Variables**: Theme customization
- **Responsive Design**: Mobile-first approach
- **Dark/Light Theme**: Built-in theme support

## 🚀 Getting Started

### Prerequisites
- **Node.js 18+**
- **npm** or **yarn** package manager
- **Git** for version control

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd engipay
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development server**
   ```bash
   npm run dev
   ```

4. **Open your browser**
   ```
   http://localhost:3000
   ```

## 📜 Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run type-check` | Check TypeScript types |

## 🎨 Design System

### Colors
- **Primary**: Purple gradient (`from-purple-600 to-purple-700`)
- **Secondary**: Blue tones
- **Accent**: Teal and green accents
- **Background**: Cosmic gradient with floating orbs

### Typography
- **Font Family**: Geist Sans & Geist Mono
- **Headings**: Bold, responsive sizing
- **Body**: Clean, readable text

### Components
- **Buttons**: Glow effects, hover animations
- **Cards**: Glassmorphism effect
- **Loaders**: Custom animated spinners
- **Forms**: Accessible form components

## 🔧 Development Guidelines

### Code Style
- **TypeScript**: Strict type checking enabled
- **ESLint**: Airbnb config with Next.js rules
- **Prettier**: Consistent code formatting

### Component Patterns
```tsx
// Example component structure
interface ComponentProps {
  title: string
  children: React.ReactNode
}

export function Component({ title, children }: ComponentProps) {
  return (
    <div className="component-class">
      <h2>{title}</h2>
      {children}
    </div>
  )
}
```

### File Naming
- **Components**: PascalCase (`Button.tsx`, `Card.tsx`)
- **Utilities**: camelCase (`utils.ts`, `helpers.ts`)
- **Pages**: `page.tsx` (Next.js convention)
- **Styles**: kebab-case (`globals.css`, `components.css`)

### Import Order
```tsx
// 1. React imports
import React from 'react'

// 2. Third-party libraries
import { useState } from 'react'

// 3. UI components
import { Button } from '@/components/ui/button'

// 4. Custom components
import { CustomComponent } from '@/components/CustomComponent'

// 5. Utilities
import { cn } from '@/lib/utils'

// 6. Types
import type { ComponentProps } from './types'
```

## 📱 Page Structure

### Landing Page (`/`)
- Hero section with animated text
- Feature cards with hover effects
- Call-to-action buttons
- Newsletter subscription
- Footer with social links

### Dashboard Page (`/dashboard`)
- Real-time wallet balance display (ETH, USDT, USDC)
- Portfolio overview with live balance cards
- Recent activity feed
- Quick action buttons
- DeFi opportunities
- Navigation tabs: Overview (internal), Payment & Swap (links to `/payments-swaps`), DeFi & Profile (links to `/defi`)

### Payments & Swaps Page (`/payments-swaps`)
- Payment options: Send, Request, QR scan, Merchant payments
- Cross-chain token swaps with Atomiq SDK
- Transaction history with filtering
- Chipi Pay integration

### DeFi Page (`/defi`)
- Portfolio overview with charts and positions
- Yield farming and staking pools
- Lending and borrowing interface
- Rewards claiming system
- Profile settings management
- Back button to dashboard

### About Page (`/about`)
- Company mission and values
- Team information
- Call-to-action for wallet connection

### Features Page (`/features`)
- Detailed feature descriptions
- Interactive cards
- Technology integrations

### Technology Page (`/technology`)
- Tech stack overview
- Security features
- Integration details

### FAQ Page (`/faq`)
- Expandable question/answer sections
- Search functionality
- Contact information

## 🎭 Animations & Interactions

### Loader Components
- **LovelyLoader**: Multi-layered spinning animation
- **Loader**: Simple spinning border
- **PulseLoader**: Three-dot pulsing animation

### Page Transitions
- **Fade-in animations** for content loading
- **Slide-in effects** for smooth transitions
- **Hover animations** for interactive elements

### Responsive Design
- **Mobile-first approach**
- **Breakpoint system**: sm, md, lg, xl
- **Touch-friendly interactions**

## 🔐 Environment Variables

Create a `.env.local` file for environment variables:

```env
# Example environment variables
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=your_project_id
```

## 🚀 Deployment

### Vercel (Recommended)
1. Connect your GitHub repository to Vercel
2. Configure build settings:
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`
3. Add environment variables
4. Deploy!

### Other Platforms
- **Netlify**: Connect repo, set build command to `npm run build`
- **Railway**: Connect repo, auto-detects Next.js
- **AWS Amplify**: Connect repo, configure build settings

## 🤝 Contributing

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/your-feature`
3. **Make your changes**
4. **Run tests**: `npm run lint`
5. **Commit your changes**: `git commit -m 'Add your feature'`
6. **Push to the branch**: `git push origin feature/your-feature`
7. **Open a Pull Request**

### Commit Convention
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation updates
- `style:` Code style changes
- `refactor:` Code refactoring
- `test:` Testing related changes

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-repo/discussions)
- **Email**: support@engipay.com

## 🙏 Acknowledgments

- **StarkNet** - For the powerful L2 infrastructure
- **Next.js Team** - For the amazing React framework
- **shadcn/ui** - For the beautiful component library
- **Tailwind CSS** - For the utility-first CSS framework

---

**Built with ❤️ by the EngiPay Team**

*Powering Lifestyle Finance on StarkNet*