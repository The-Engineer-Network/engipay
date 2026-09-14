interface LoaderProps {
  size?: "sm" | "md" | "lg"
  className?: string
}

export function Loader({ size = "md", className = "" }: LoaderProps) {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-8 h-8",
    lg: "w-12 h-12"
  }

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div
        className={`animate-spin rounded-full border-2 border-primary/25 border-t-primary ${sizeClasses[size]}`}
        style={{
          animation: "spin 1s linear infinite"
        }}
      />
    </div>
  )
}

export function LovelyLoader({ size = "md", className = "" }: LoaderProps) {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-8 h-8",
    lg: "w-12 h-12"
  }

  const innerSizes = {
    sm: "w-2 h-2",
    md: "w-4 h-4",
    lg: "w-6 h-6"
  }

  const dotSizes = {
    sm: "w-1 h-1 top-1.5 left-1.5",
    md: "w-2 h-2 top-3 left-3",
    lg: "w-3 h-3 top-4.5 left-4.5"
  }

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className="relative">
        {/* Outer ring */}
        <div
          className={`animate-spin rounded-full border-2 border-primary/20 border-t-primary ${sizeClasses[size]}`}
        />
        {/* Inner ring */}
        <div
          className={`absolute top-1 left-1 animate-spin rounded-full border-2 border-transparent border-t-primary/50 ${innerSizes[size]}`}
          style={{
            animation: "spin 0.8s linear infinite reverse"
          }}
        />
        {/* Center dot */}
        <div
          className={`absolute rounded-full bg-primary ${dotSizes[size]}`}
        />
      </div>
    </div>
  )
}

export function PulseLoader({ size = "md", className = "" }: LoaderProps) {
  const sizeClasses = {
    sm: "w-2 h-2",
    md: "w-3 h-3",
    lg: "w-4 h-4"
  }

  return (
    <div className={`flex items-center space-x-1 ${className}`}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`bg-primary rounded-full animate-pulse ${sizeClasses[size]}`}
          style={{
            animationDelay: `${i * 0.2}s`,
            animationDuration: "1.5s"
          }}
        />
      ))}
    </div>
  )
}