// TS_NODE_TRANSPILE_ONLY=1 npx hardhat run ./scripts/accounting.ts

import hre from 'hardhat'
import '@nomiclabs/hardhat-waffle'
import { addresses } from '../test/shared/addresses'
import { BN, BNe } from '../test/shared/math'
import { TestERC20 } from '../typechain'

import UniswapV3PoolJson from '@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json'
import UniswapV3FactoryJson from '@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json'

const impersonate = async (address) =>
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  })

const unimpersonate = async (address) =>
  await hre.network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [address],
  })

const setup = async (signer) => {
  // Deploy Staker
  const uniswapV3Factory = await hre.ethers.getContractAt(
    UniswapV3FactoryJson.abi,
    addresses.UniswapV3Factory
  )
  const stakerFactory = await hre.ethers.getContractFactory(
    'UniswapV3Staker',
    signer
  )
  const staker = await stakerFactory.deploy(
    uniswapV3Factory.address,
    addresses.NonfungiblePositionManager
  )
  const pool = await hre.ethers.getContractAt(
    UniswapV3PoolJson.abi,
    addresses.POOL_USDC_WETH
  )

  const getERC20 = async (address: string) => {
    /** Impersonates the ERC20 and returns a contract with a bound signer */
    await impersonate(address)
    return (await hre.ethers.getContractAt(
      'TestERC20',
      address,
      await hre.ethers.provider.getSigner(address)
    )) as TestERC20
  }

  const usdc = await getERC20(addresses.USDC)
  const wbtc = await getERC20(addresses.WBTC)
  const weth = await getERC20(addresses.WETH)
  const shib = await getERC20(addresses.SHIB)
  const mkr = await getERC20(addresses.MKR)

  return {
    uniswapV3Factory,
    staker,
    pool,
    usdc,
    weth,
    shib,
    wbtc,
    mkr,
  }
}

const main = async () => {
  console.info('all your math are belong to us')

  const signer = (await hre.ethers.getSigners())[0]
  const {
    uniswapV3Factory,
    pool,
    staker,
    usdc,
    weth,
    shib,
    wbtc,
    mkr,
  } = await setup(signer)

  const recp = await signer.getAddress()

  await wbtc.mint(recp, BNe(5, 8))
  await weth.transfer(recp, BNe(1, 18))
  // await shib.transfer(recp, BNe(5, 18))
  // await usdc.transferFrom(addresses.USDC, recp, BNe(2000, 6))

  console.info(await weth.balanceOf(recp))
  console.info(await wbtc.balanceOf(recp))

  // await usdc.transfer(recp, BNe(1000, 6))
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
