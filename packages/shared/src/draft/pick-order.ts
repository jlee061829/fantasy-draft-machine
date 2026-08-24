// Structural, persistence-independent union — deliberately not imported from
// @fdm/database's Prisma-generated DraftType, so this package has no
// dependency on the database package for pure domain logic. Prisma's
// DraftType ("SNAKE" | "LINEAR" underneath) remains structurally assignable
// here without conversion.
type DraftType = "SNAKE" | "LINEAR";

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

// Pure turn-order logic, deliberately isolated from persistence so it can be
// unit-tested directly at round boundaries — that's where snake logic
// actually breaks — and reused unchanged by both the web app (draft start)
// and the future socket server (pick submission, autopick).
//
// pickNumber is 1-indexed. SNAKE reverses direction every round (1..N, then
// N..1, then 1..N, ...); LINEAR always goes 1..N. Both draft types start
// pick 1 at draftSlot 1.
//
// Inputs are validated explicitly rather than trusted: this function sits on
// the server-authoritative path (draft start now, pick submission/autopick
// later), so a malformed pickNumber/numTeams must fail loudly instead of
// silently producing a meaningless draftSlot.
export function getPickerForPickNumber(
  pickNumber: number,
  numTeams: number,
  draftType: DraftType,
): number {
  if (!isPositiveInteger(pickNumber)) {
    throw new RangeError(`pickNumber must be a positive integer, received ${pickNumber}`);
  }
  if (!isPositiveInteger(numTeams)) {
    throw new RangeError(`numTeams must be a positive integer, received ${numTeams}`);
  }

  const zeroIndexedPick = pickNumber - 1;
  const round = Math.floor(zeroIndexedPick / numTeams);
  const positionInRound = zeroIndexedPick % numTeams;

  switch (draftType) {
    case "LINEAR":
      return positionInRound + 1;
    case "SNAKE":
      return round % 2 === 0 ? positionInRound + 1 : numTeams - positionInRound;
    default:
      throw new RangeError(`Unsupported draftType: ${draftType as string}`);
  }
}
