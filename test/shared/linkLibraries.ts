/*
This is needed because there's currently no way in ethers.js to link a
library when you're working with the contract ABI/bytecode.

See https://github.com/ethers-io/ethers.js/issues/195
*/

import { utils } from 'ethers'

export const linkLibraries = (
  {
    bytecode,
    linkReferences,
  }: {
    bytecode: string
    linkReferences: {
      [fileName: string]: {
        [contractName: string]: { length: number; start: number }[]
      }
    }
  },
  libraries: { [libraryName: string]: string }
): string => {
  Object.keys(linkReferences).forEach((fileName) => {
    Object.keys(linkReferences[fileName]).forEach((contractName) => {
      if (!libraries.hasOwnProperty(contractName)) {
        throw new Error(`Missing link library name ${contractName}`)
      }
      const address = utils.getAddress(libraries[contractName]).toLowerCase().slice(2)
      linkReferences[fileName][contractName].forEach(({ start: byteStart, length: byteLength }) => {
        const start = 2 + byteStart * 2
        const length = byteLength * 2
        bytecode = bytecode
          .slice(0, start)
          .concat(address)
          .concat(bytecode.slice(start + length, bytecode.length))
      })
    })
  })
  return bytecode
}
