import pytest
from functools import partial
import brownie
from brownie import UniswapV3Staker
from ..conftest import pending


def test_staker_deploy(accounts, uniswap_nft_position_manager, uniswap_v3_factory):
    staker = accounts[0].deploy(
        UniswapV3Staker,
        uniswap_v3_factory.address,
        uniswap_nft_position_manager.address,
    )
    assert staker.address is not None


@pytest.fixture
def total_reward():
    yield 500
