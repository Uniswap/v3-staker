/* https://github.com/Uniswap/uniswap-v3-periphery/blob/710d51dca94e1feeee9b039a9bc4428ff80f7232/test/shared/tokenSort.ts */

export function compareToken(a: { address: string }, b: { address: string }): -1 | 1 {
  return a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
}

export function sortedTokens(
  a: { address: string },
  b: { address: string }
): [typeof a, typeof b] | [typeof b, typeof a] {
  return compareToken(a, b) < 0 ? [a, b] : [b, a]
}
