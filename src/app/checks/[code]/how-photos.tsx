"use client"

import { useState } from "react"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  CarouselViewport,
} from "@ui-sdk/react/carousel"
import { crewHelpPhotoUrl } from "@/lib/checks/help"

/**
 * The owner's reference photos in the crew how-to sheet. Its own module so the
 * page loads it with next/dynamic: the carousel only ships when a crew member
 * opens a how-to that has photos, not with the checklist itself.
 */
export default function HowPhotos({
  code,
  photos,
  label,
  photoOf,
  prev,
  next,
}: {
  code: string
  photos: string[]
  label: string
  photoOf: (k: number, n: number) => string
  prev: string
  next: string
}) {
  const [page, setPage] = useState(1)
  const n = photos.length
  return (
    <Carousel className="ckb__ref" aria-label={label} page={page} onPageChange={(p) => setPage(p)}>
      <CarouselViewport className="ckb__refview">
        <CarouselContent className="ckb__refrow">
          {photos.map((key, k) => (
            <CarouselItem key={key} className="ckb__refslide">
              <img src={crewHelpPhotoUrl(code, key)} alt={photoOf(k + 1, n)} loading={k === 0 ? "eager" : "lazy"} />
            </CarouselItem>
          ))}
        </CarouselContent>
      </CarouselViewport>
      <span className="ckb__reftag">
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="3" y="5" width="18" height="14" />
          <circle cx="9" cy="10" r="1.8" />
          <path d="M21 16l-5-5-8 8" />
        </svg>{" "}
        {label}
      </span>
      {n > 1 && (
        <>
          <span className="ckb__refn">
            {page} / {n}
          </span>
          <CarouselPrevious className="ckb__refnav l" aria-label={prev}>
            ‹
          </CarouselPrevious>
          <CarouselNext className="ckb__refnav r" aria-label={next}>
            ›
          </CarouselNext>
        </>
      )}
    </Carousel>
  )
}
