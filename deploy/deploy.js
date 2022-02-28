const UNI_V3_FACTORY = '0x1f98431c8ad98523631ae4a59f267346ea31f984';
const UNI_V3_POSITIONS = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';

// Copied from existing deployment:
const maxIncentiveStartLeadTime = '0x278d';
const maxIncentiveDuration = '0x03c26700';

const chainConfig = {
  '4': {
    nativeName: 'ETH',
    weth: '0xc778417E063141139Fce010982780140Aa0cD5Ab',
    dai: '0x6A9865aDE2B6207dAAC49f8bCba9705dEB0B0e6D',
    usdc: ethers.constants.AddressZero,
    usdt: ethers.constants.AddressZero,
    wbtc: ethers.constants.AddressZero,
  },
}

const func = async function ({ deployments, getNamedAccounts, getChainId }) {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  const chainId = await getChainId();
  const config = chainConfig[chainId];
  if (!config) {
    throw new Error(`Config not found on chain ${chainId}`)
  }

  const staker = await deploy('UniswapV3Staker', {
    args: [UNI_V3_FACTORY, UNI_V3_POSITIONS, maxIncentiveStartLeadTime, maxIncentiveDuration],
    from: deployer,
  });
  console.log(`Deployed staker to ${staker.address}`);

  const descriptorGenerator = await deploy('StakedNFTDescriptorGenerator', { from: deployer, deterministicDeployment: true });
  console.log(`Deployed descriptor generator to ${descriptorGenerator.address}`);

  const descriptorLogic = await deploy('StakedNFTDescriptor', {
    from: deployer,
    args: [config.weth, ethers.utils.formatBytes32String(config.nativeName), config.dai, config.usdc, config.usdt, config.wbtc],
    deterministicDeployment: true,
    libraries: {
      StakedNFTDescriptorGenerator: descriptorGenerator.address,
    },
  });
  console.log(`Deployed descriptor to ${descriptorLogic.address}`);

  const descriptorProxy = await deploy('TransparentUpgradeableProxy', {
    from: deployer,
    args: [descriptorLogic.address, deployer, []],
  });
  console.log(`Deployed descriptor proxy to ${descriptorProxy.address}`);

  const nft = await deploy('UniswapStakerNFT', {
    from: deployer,
    args: [staker.address, descriptorProxy.address],
  });
  console.log(`Deployed NFT to ${nft.address}`);
};

module.exports = func;
