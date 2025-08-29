import { Star, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "./button"

interface StarRatingProps {
  rating?: number | null
  reviewCount?: number | null
  url?: string | null
  lastUpdated?: Date | string | null
  size?: "sm" | "md" | "lg"
  showLabel?: boolean
  showLink?: boolean
  className?: string
}

export function StarRating({
  rating,
  reviewCount,
  url,
  lastUpdated,
  size = "md",
  showLabel = true,
  showLink = true,
  className
}: StarRatingProps) {
  const sizeClasses = {
    sm: "text-sm",
    md: "text-base", 
    lg: "text-lg"
  }

  const starSizes = {
    sm: "h-3 w-3",
    md: "h-4 w-4",
    lg: "h-5 w-5"
  }

  // If no rating data, show zero stars
  const displayRating = rating || 0
  const displayReviewCount = reviewCount || 0

  const renderStars = () => {
    const stars = []
    const fullStars = Math.floor(displayRating)
    const hasHalfStar = displayRating % 1 >= 0.5
    const totalStars = 5

    // Full stars
    for (let i = 0; i < fullStars; i++) {
      stars.push(
        <Star
          key={`full-${i}`}
          className={cn(starSizes[size], "fill-yellow-400 text-yellow-400")}
        />
      )
    }

    // Half star
    if (hasHalfStar) {
      stars.push(
        <div key="half" className={cn(starSizes[size], "relative")}>
          <Star className={cn(starSizes[size], "text-gray-300 absolute")} />
          <Star 
            className={cn(starSizes[size], "fill-yellow-400 text-yellow-400 absolute")}
            style={{ clipPath: "inset(0 50% 0 0)" }}
          />
        </div>
      )
    }

    // Empty stars
    const emptyStars = totalStars - fullStars - (hasHalfStar ? 1 : 0)
    for (let i = 0; i < emptyStars; i++) {
      stars.push(
        <Star
          key={`empty-${i}`}
          className={cn(starSizes[size], "text-gray-300")}
        />
      )
    }

    return stars
  }

  const formatLastUpdated = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toLocaleDateString()
  }

  return (
    <div className={cn("flex items-center gap-2", sizeClasses[size], className)}>
      {/* Star Icons */}
      <div className="flex items-center gap-0.5">
        {renderStars()}
      </div>

      {/* Rating and Review Count */}
      {showLabel && (
        <div className="flex items-center gap-1">
          {displayRating > 0 ? (
            <>
              <span className="font-medium">{displayRating.toFixed(1)}</span>
              {displayReviewCount > 0 && (
                <span className="text-muted-foreground">
                  ({displayReviewCount.toLocaleString()} {displayReviewCount === 1 ? 'review' : 'reviews'})
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">No Yelp rating</span>
          )}
        </div>
      )}

      {/* Yelp Link */}
      {showLink && url && displayRating > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-auto p-1 text-muted-foreground hover:text-foreground"
          asChild
        >
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            Yelp
          </a>
        </Button>
      )}

      {/* Last Updated (optional debug info) */}
      {lastUpdated && process.env.NODE_ENV === 'development' && (
        <span className="text-xs text-muted-foreground">
          Updated: {formatLastUpdated(lastUpdated)}
        </span>
      )}
    </div>
  )
}

// Compact version for cards
export function StarRatingCompact({
  rating,
  reviewCount,
  url,
  className
}: Pick<StarRatingProps, "rating" | "reviewCount" | "url" | "className">) {
  return (
    <StarRating
      rating={rating}
      reviewCount={reviewCount}
      url={url}
      size="sm"
      showLabel={false}
      showLink={false}
      className={className}
    />
  )
}

// Large version for store details
export function StarRatingLarge({
  rating,
  reviewCount,
  url,
  lastUpdated,
  className
}: StarRatingProps) {
  return (
    <StarRating
      rating={rating}
      reviewCount={reviewCount}
      url={url}
      lastUpdated={lastUpdated}
      size="lg"
      showLabel={true}
      showLink={true}
      className={className}
    />
  )
}