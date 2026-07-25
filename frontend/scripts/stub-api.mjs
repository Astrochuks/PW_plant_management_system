/** Stub for check-brief.mjs — buildBriefDoc is pure and never calls this. */
export const getExecutiveBrief = () => {
  throw new Error('getExecutiveBrief must not be called while building the document')
}
