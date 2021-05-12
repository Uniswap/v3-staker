import pytest
import brownie
import functools


@pytest.fixture(scope="module")
def create_incentive(
    deployed_staker, reward_token, uniswap_pool, total_reward, accounts
):
    start_time = 0
    end_time = 1
    claim_deadline = 10
    yield functools.partial(
        deployed_staker.createIncentive,
        reward_token.address,
        uniswap_pool.address,
        start_time,
        end_time,
        claim_deadline,
        total_reward,
        {"from": accounts[0]},
    )


class CreateIncentiveTests:
    def test_happy_path(
        deployed_staker,
        reward_token,
        accounts,
        create_incentive,
        total_reward,
    ):
        with brownie.reverts("allowance insufficient"):
            create_incentive()
        reward_token.approve(
            deployed_staker.address, total_reward, {"from": accounts[0]}
        )
        # works now
        result = create_incentive()
        assert "IncentiveCreated" in result.events
        assert "Transfer" in result.events
        # TODO: make sure the right amount is transfered
        # TODO: make sure the staker now has the correct balance

    def test_fail_if_incentive_exists(self):
        create_incentive()
        with brownie.reverts("incentive exists"):
            create_incentive()

    def test_fail_if_claim_deadline_not_gte_end_time(self):
        pass


class EndIncentiveTests:
    def test_happy_path(self):
        pass

    def test_cannot_end_when_before_endtime(self):
        pass