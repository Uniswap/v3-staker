import pytest
import brownie
import functools
from brownie import UniswapV3Staker
from .conftest import pending, reward_token


class DeploymentTests:
    def test_staker_deploy(self, accounts, nft_position_manager, uniswap_v3_factory):
        staker = accounts[0].deploy(
            UniswapV3Staker,
            uniswap_v3_factory.address,
            nft_position_manager.address,
        )
        assert staker.address is not None
        assert staker.factory == uniswap_v3_factory.address
        assert staker.nft_position_manager == nft_position_manager.address


def _create_incentive(account,
                      staker,
                      uniswap_pool,
                      reward,
                      start_time=0,
                      end_time=10,
                      claim_deadline=20,
                      total_reward=100):
    return staker.createIncentive(
        reward.address,
        uniswap_pool.address,
        start_time,
        end_time,
        claim_deadline,
        total_reward,
        {"from": account},
    )


def test_create_incentive(staker, accounts, reward_token, reward_token2, uniswap_pool):
    account = accounts[0]
    total_reward = 500
    with brownie.reverts("allowance insufficient"):
        _create_incentive(account, staker, uniswap_pool, total_reward=total_reward)
    reward_token.approve(staker.address, total_reward, {"from": accounts[0]})
    tx1 = _create_incentive(account, staker, uniswap_pool, total_reward=total_reward)

    def creates_incentive(_):
        assert "IncentiveCreated" in _.events
        assert "Transfer" in _.events
        return True

    assert creates_incentive(tx1)

    with brownie.reverts('INCENTIVE_EXISTS'):
        _create_incentive(account, staker, uniswap_pool, total_reward=1)

    total_reward = 750
    reward_token2.approve(staker.address, total_reward, {"from": accounts[0]})
    tx2 = _create_incentive(account, staker, uniswap_pool, reward=reward_token2, total_reward=total_reward)
    assert creates_incentive(tx2)

    with brownie.reverts('INCENTIVE_EXISTS'):
        _create_incentive(account, staker, uniswap_pool, reward=reward_token2, total_reward=total_reward)


INVALID_TIMESTAMPS = [[2, 1, 5], [1, 2, 0], [10, 4, 5]]


@pytest.mark.parametrize('start_time,end_time,claim_deadline', INVALID_TIMESTAMPS)
def test_incentive_creation_fails_if_invalid_times(start_time, end_time, claim_deadline, accounts, staker, uniswap_pool,
                                                   reward_token):
    account = accounts[0]
    with brownie.reverts('TIMESTAMPS'):
        _create_incentive(account, staker, uniswap_pool, reward_token, start_time, end_time, claim_deadline)


class FeeAmount:
    LOW = 500
    MEDIUM = 3_000
    HIGH = 10_000


import math


def encode_price_sqrt(reserve1, reserve0):
    return math.floor(math.sqrt(reserve1 / reserve0) * math.pow(2, 96))


def test_deposit(account, nft_position_manager, token0, token1):
    fee_amount = FeeAmount.LOW
    tx = nft_position_manager.createAndInitializePoolIfNecessary(token0.address, token1.address, fee_amount,
                                                                 encode_price_sqrt(200000, 100000), {
                                                                     "value": 10,
                                                                     "from": account
                                                                 })

    assert tx is not None
    assert 'PoolCreated' in tx.events

    creation_event = tx.events['PoolCreated'][0]
    assert creation_event['token0'] == token0.address
    assert creation_event['token1'] == token1.address
