import functools
import pytest
from brownie import ERC20, Contract, UniswapV3Staker
from config import load_abi

modfix = functools.partial(pytest.fixture, scope="module")
pending = functools.partial(pytest.mark.skip, reason="test pending")

addresses = {
    "Multicall2": "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696",
    "NFTDescriptor": "0x42B24A95702b9986e82d421cC3568932790A48Ec",
    "NonfungiblePositionManager": "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    "NonfungibleTokenPositionDescriptor": "0x91ae842A5Ffd8d12023116943e72A606179294f3",
    "ProxyAdmin": "0xB753548F6E010e7e680BA186F9Ca1BdAB2E90cf2",
    "Quoter": "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
    "SwapRouter": "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    "TickLens": "0xbfd8137f7d1516D3ea5cA83523914859ec47F573",
    "TransparentUpgradeableProxy": "0xEe6A57eC80ea46401049E92587E52f5Ec1c24785",
    "UniswapV3Factory": "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    "V3Migrator": "0xA5644E29708357803b5A882D272c41cC0dF92B34",
}

USDC_ETH_POOL = "0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8"


@modfix
def uniswap_v3_factory(accounts):
    yield Contract.from_explorer(addresses["UniswapV3Factory"])


@modfix
def uniswap_nft_position_manager():
    yield Contract.from_explorer(addresses["NonfungiblePositionManager"])


@modfix
def token0(ERC20, accounts):
    yield ERC20.deploy(1000, {"from": accounts[0]})
    # yield ERC20.deploy("Coin A", "USDA", 18, {"from": accounts[0]})


@modfix
def token1(ERC20, accounts):
    yield ERC20.deploy(1000, {"from": accounts[0]})
    # yield ERC20.deploy("Coin B", "USDB", 18, {"from": accounts[0]})


@modfix
def uniswap_pool():
    pool_abi = load_abi("UniswapV3Pool")["abi"]
    yield Contract.from_abi("UniswapV3Pool", USDC_ETH_POOL, pool_abi)


@modfix
def reward_token(ERC20, accounts):
    yield ERC20.deploy(1000, {"from": accounts[0]})


@modfix
def deployed_staker(accounts, uniswap_v3_factory, uniswap_nft_position_manager):
    yield accounts[0].deploy(
        UniswapV3Staker,
        uniswap_v3_factory.address,
        uniswap_nft_position_manager.address,
    )
