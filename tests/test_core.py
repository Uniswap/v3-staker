import pytest
from functools import partial
import brownie
from brownie import UniswapV3Staker
from .conftest import pending


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


@pytest.fixture
def create_incentive(
    deployed_staker, reward_token, uniswap_pool, total_reward, accounts
):
    start_time = 0
    end_time = 1
    claim_deadline = 10
    yield partial(
        deployed_staker.createIncentive,
        reward_token.address,
        uniswap_pool.address,
        start_time,
        end_time,
        claim_deadline,
        total_reward,
        {"from": accounts[0]},
    )


def test_create_incentive(
    deployed_staker,
    reward_token,
    accounts,
    create_incentive,
    total_reward,
):

    # reverts because not allowed
    with brownie.reverts("allowance insufficient"):
        create_incentive()
    reward_token.approve(deployed_staker.address, total_reward, {"from": accounts[0]})

    # works now
    result = create_incentive()
    assert "IncentiveCreated" in result.events
    assert "Transfer" in result.events
    # TODO: make sure the right amount is transfered
    # TODO: make sure the staker now has the correct balance
