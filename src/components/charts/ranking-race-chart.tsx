"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { Play, Pause, RotateCcw } from "lucide-react"
import { motion } from "framer-motion"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Slider } from "@/components/ui/slider"
import { formatCurrency, formatNumber, formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { RaceDayFrame } from "@/types/analytics"

const RACE_COLORS = [
  "hsl(221, 83%, 53%)",  // blue
  "hsl(20, 91%, 48%)",   // orange
  "hsl(142, 71%, 45%)",  // green
  "hsl(262, 83%, 58%)",  // purple
  "hsl(346, 77%, 50%)",  // rose
  "hsl(47, 96%, 53%)",   // yellow
  "hsl(186, 72%, 45%)",  // cyan
  "hsl(316, 72%, 51%)",  // pink
  "hsl(30, 80%, 55%)",   // amber
  "hsl(199, 89%, 48%)",  // sky
]

interface RankingRaceChartProps {
  frames: RaceDayFrame[]
  onItemClick?: (itemName: string, category: string) => void
  className?: string
}

const BAR_HEIGHT = 36
const GAP = 4

export function RankingRaceChart({
  frames,
  onItemClick,
  className,
}: RankingRaceChartProps) {
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState<"1" | "2" | "4">("1")
  const [mode, setMode] = useState<"quantity" | "revenue">("quantity")
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const rawFrame = frames[currentFrameIndex] ?? frames[0]
  const itemCount = rawFrame?.rankings.length ?? 0

  // Re-sort rankings client-side based on selected mode
  const currentFrame = useMemo(() => {
    if (!rawFrame) return rawFrame
    const sorted = [...rawFrame.rankings]
      .sort((a, b) =>
        mode === "quantity"
          ? b.cumulativeQuantity - a.cumulativeQuantity
          : b.cumulativeRevenue - a.cumulativeRevenue
      )
      .map((entry, idx) => ({ ...entry, rank: idx + 1 }))
    return { ...rawFrame, rankings: sorted }
  }, [rawFrame, mode])

  // Assign stable colors based on first frame
  const colorMap = useMemo(() => {
    const map = new Map<string, string>()
    if (frames.length > 0) {
      frames[0].rankings.forEach((entry, idx) => {
        map.set(entry.itemName, RACE_COLORS[idx % RACE_COLORS.length])
      })
    }
    return map
  }, [frames])

  // Max value across all frames for consistent scaling
  const maxValue = useMemo(() => {
    if (frames.length === 0) return 1
    const lastFrame = frames[frames.length - 1]
    return Math.max(
      ...lastFrame.rankings.map((r) =>
        mode === "quantity" ? r.cumulativeQuantity : r.cumulativeRevenue
      ),
      1
    )
  }, [frames, mode])

  const play = useCallback(() => setIsPlaying(true), [])
  const pause = useCallback(() => setIsPlaying(false), [])
  const reset = useCallback(() => {
    setIsPlaying(false)
    setCurrentFrameIndex(0)
  }, [])

  useEffect(() => {
    if (!isPlaying) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }

    const ms = 1000 / Number(speed)
    intervalRef.current = setInterval(() => {
      setCurrentFrameIndex((prev) => {
        if (prev >= frames.length - 1) {
          setIsPlaying(false)
          return prev
        }
        return prev + 1
      })
    }, ms)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isPlaying, speed, frames.length])

  if (frames.length === 0 || !currentFrame) return null

  const formatter = mode === "quantity" ? formatNumber : formatCurrency
  const containerHeight = itemCount * (BAR_HEIGHT + GAP) + GAP

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base">Menu Item Rankings</CardTitle>
            <CardDescription>
              Watch how items compete over time — cumulative {mode}
            </CardDescription>
          </div>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && setMode(v as "quantity" | "revenue")}
          >
            <ToggleGroupItem value="quantity" size="sm" className="text-xs px-2.5 h-7">
              Qty
            </ToggleGroupItem>
            <ToggleGroupItem value="revenue" size="sm" className="text-xs px-2.5 h-7">
              Revenue
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={isPlaying ? pause : play}
            className="h-8 w-8 p-0"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
          </Button>
          <Button variant="outline" size="sm" onClick={reset} className="h-8 w-8 p-0" aria-label="Reset">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>

          <ToggleGroup
            type="single"
            value={speed}
            onValueChange={(v) => v && setSpeed(v as "1" | "2" | "4")}
          >
            <ToggleGroupItem value="1" size="sm" className="text-xs px-2 h-7">1x</ToggleGroupItem>
            <ToggleGroupItem value="2" size="sm" className="text-xs px-2 h-7">2x</ToggleGroupItem>
            <ToggleGroupItem value="4" size="sm" className="text-xs px-2 h-7">4x</ToggleGroupItem>
          </ToggleGroup>

          <div className="ml-auto font-mono text-sm font-medium text-foreground/80">
            {formatDate(currentFrame.date)}
          </div>
        </div>

        {/* Scrub slider */}
        <Slider
          value={[currentFrameIndex]}
          min={0}
          max={Math.max(frames.length - 1, 0)}
          step={1}
          onValueChange={([v]) => {
            setIsPlaying(false)
            setCurrentFrameIndex(v)
          }}
          className="w-full"
        />

        {/* Race bars */}
        <div className="relative" style={{ height: containerHeight }}>
          {currentFrame.rankings.map((entry) => {
            const value = mode === "quantity" ? entry.cumulativeQuantity : entry.cumulativeRevenue
            const widthPercent = maxValue > 0 ? (value / maxValue) * 100 : 0
            const color = colorMap.get(entry.itemName) ?? RACE_COLORS[0]
            const yPos = (entry.rank - 1) * (BAR_HEIGHT + GAP) + GAP

            return (
              <motion.div
                key={entry.itemName}
                layout
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="absolute left-0 right-0 flex items-center gap-2"
                style={{ top: yPos, height: BAR_HEIGHT }}
              >
                {/* Rank number */}
                <span className="w-5 text-xs font-medium text-muted-foreground text-right shrink-0">
                  {entry.rank}
                </span>

                {/* Bar + label container */}
                <div className="flex-1 relative h-full">
                  <motion.div
                    className={cn(
                      "h-full rounded-r-md flex items-center px-2 cursor-pointer",
                      "hover:brightness-110 transition-[filter]"
                    )}
                    style={{ backgroundColor: color, width: `${Math.max(widthPercent, 2)}%` }}
                    animate={{ width: `${Math.max(widthPercent, 2)}%` }}
                    transition={{ duration: 0.3 }}
                    onClick={() => onItemClick?.(entry.itemName, entry.category)}
                  >
                    <span className="text-xs font-medium text-white truncate drop-shadow-sm">
                      {entry.itemName}
                    </span>
                  </motion.div>

                  {/* Value label outside bar */}
                  <span
                    className="absolute text-xs text-muted-foreground font-mono top-1/2 -translate-y-1/2"
                    style={{ left: `calc(${Math.max(widthPercent, 2)}% + 8px)` }}
                  >
                    {formatter(value)}
                  </span>
                </div>
              </motion.div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
