import { MobileRouteLoading } from "@/components/mobile/mobile-loading"

/**
 * The stock count's own loading boundary.
 *
 * It had none, and inherited `/m/loading.tsx` — which drew the `/m` HOME
 * skeleton, masthead and all, over every route in this segment. That file
 * renders nothing now (see its note), so the four routes that were leaning on
 * it need to say what they want. This is the only one that wants a skeleton:
 * `/m/login` paints instantly, `/m/settings` is a proxy redirect that never
 * renders, and a 404 has nothing to draw a placeholder for.
 */
export default function MobileCountLoading() {
  return (
    <MobileRouteLoading
      route="/m/count"
      dept="INVENTORY"
      title="Count"
      rows={6}
    />
  )
}
