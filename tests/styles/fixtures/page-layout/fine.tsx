// Fixture: follows the page layout rules (answer + four blocks, one-thing fold).
export function Fine() {
  return (
    <>
      <Section title="Answer" />
      <Card label="One" />
      <Card label="Two" />
      <Section title="Three" />
      <Section title="Four" />
      <Fold summary="How this is worked out">
        <Card label="Method" />
      </Fold>
    </>
  )
}
