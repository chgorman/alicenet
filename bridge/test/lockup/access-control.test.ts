import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { BonusPool, Lockup, RewardPool } from "../../typechain-types";
import { BaseTokensFixture } from "../setup";
import {
  deployFixture,
  jumpToInlockState,
  jumpToPostLockState,
  lockStakedNFT,
  LockupStates,
} from "./setup";

interface Fixture extends BaseTokensFixture {
  lockup: Lockup;
  rewardPool: RewardPool;
  bonusPool: BonusPool;
}

describe("Testing Lockup Access Control", async () => {
  let fixture: Fixture;
  let accounts: SignerWithAddress[];
  let asPublicStaking: SignerWithAddress;
  let asRewardPool: SignerWithAddress;
  let stakedTokenIDs: BigNumber[] = [];

  beforeEach(async () => {
    ({ fixture, accounts, stakedTokenIDs, asPublicStaking, asRewardPool } =
      await loadFixture(deployFixture));
  });

  it("BonusPool should not receive ETH from address different that PublicStaking or RewardPool contracts [ @skip-on-coverage ]", async () => {
    await expect(
      accounts[0].sendTransaction({
        to: fixture.lockup.address,
        value: ethers.utils.parseEther("1"),
      })
    ).to.be.revertedWithCustomError(
      fixture.lockup,
      "AddressNotAllowedToSendEther"
    );
  });

  it("should receive ETH from PublicStaking contract [ @skip-on-coverage ]", async () => {
    await asPublicStaking.sendTransaction({
      to: fixture.lockup.address,
      value: 1,
    });
  });

  it("should receive ETH from RewardPool contract [ @skip-on-coverage ]", async () => {
    await asRewardPool.sendTransaction({
      to: fixture.lockup.address,
      value: 1,
    });
  });

  describe("Testing onlyPreLock functions", async () => {
    it("attempts to use onERC721Received [ @skip-on-coverage ]", async () => {
      expect(await fixture.lockup.getState()).to.be.equals(
        LockupStates.PreLock
      );
      await expect(
        fixture.lockup
          .connect(asPublicStaking)
          .onERC721Received(
            ethers.constants.AddressZero,
            ethers.constants.AddressZero,
            0,
            []
          )
      ).to.be.revertedWith("ERC721: invalid token ID");
      await expect(
        fixture.lockup.onERC721Received(
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          0,
          []
        )
      ).to.be.revertedWithCustomError(fixture.lockup, "OnlyStakingNFTAllowed");
      await jumpToInlockState(fixture);
      await expect(
        fixture.lockup
          .connect(asPublicStaking)
          .onERC721Received(
            ethers.constants.AddressZero,
            ethers.constants.AddressZero,
            0,
            []
          )
      ).to.be.revertedWithCustomError(fixture.lockup, "PreLockStateRequired");
      await jumpToPostLockState(fixture);
      await expect(
        fixture.lockup
          .connect(asPublicStaking)
          .onERC721Received(
            ethers.constants.AddressZero,
            ethers.constants.AddressZero,
            0,
            []
          )
      ).to.be.revertedWithCustomError(fixture.lockup, "PreLockStateRequired");
    });

    it("attempts to use lockFromTransfer [ @skip-on-coverage ]", async () => {
      expect(await fixture.lockup.getState()).to.be.equals(
        LockupStates.PreLock
      );
      await expect(
        fixture.lockup.lockFromTransfer(0, ethers.constants.AddressZero)
      ).to.be.revertedWith("ERC721: invalid token ID");
      await jumpToInlockState(fixture);
      await expect(
        fixture.lockup.lockFromTransfer(0, ethers.constants.AddressZero)
      ).to.be.revertedWithCustomError(fixture.lockup, "PreLockStateRequired");
      await jumpToPostLockState(fixture);
      await expect(
        fixture.lockup.lockFromTransfer(0, ethers.constants.AddressZero)
      ).to.be.revertedWithCustomError(fixture.lockup, "PreLockStateRequired");
    });

    it("attempts to use lockFromApproval [ @skip-on-coverage ]", async () => {
      // minted a position with tokenID1
      await fixture.publicStaking.mint(1000);
      const tokenID = 1;
      await fixture.publicStaking.approve(fixture.lockup.address, tokenID);
      expect(await fixture.lockup.getState()).to.be.equals(
        LockupStates.PreLock
      );
      await jumpToInlockState(fixture);
      await expect(
        fixture.lockup.lockFromApproval(tokenID)
      ).to.be.revertedWithCustomError(fixture.lockup, "PreLockStateRequired");
      await jumpToPostLockState(fixture);
      await expect(
        fixture.lockup.lockFromApproval(tokenID)
      ).to.be.revertedWithCustomError(fixture.lockup, "PreLockStateRequired");
    });
  });

  describe("Testing excludePostLock functions", async () => {
    it("attempts to use collectAllProfits [ @skip-on-coverage ]", async () => {
      await jumpToPostLockState(fixture);
      await expect(
        fixture.lockup.collectAllProfits()
      ).to.be.revertedWithCustomError(
        fixture.lockup,
        "PostLockStateNotAllowed"
      );
    });
    it("attempts to unlock early [ @skip-on-coverage ]", async () => {
      await jumpToPostLockState(fixture);
      await expect(
        fixture.lockup.unlockEarly(1000, false)
      ).to.be.revertedWithCustomError(
        fixture.lockup,
        "PostLockStateNotAllowed"
      );
    });
  });

  describe("Testing onlyPostLock functions", async () => {
    it("attempts to use aggregateProfits [ @skip-on-coverage ]", async () => {
      await lockStakedNFT(fixture, accounts[1], stakedTokenIDs[1]);
      expect(await fixture.lockup.getState()).to.be.equals(
        LockupStates.PreLock
      );
      await expect(
        fixture.lockup.aggregateProfits()
      ).to.be.revertedWithCustomError(fixture.lockup, "PostLockStateRequired");
      await jumpToInlockState(fixture);
      await expect(
        fixture.lockup.aggregateProfits()
      ).to.be.revertedWithCustomError(fixture.lockup, "PostLockStateRequired");
      await jumpToPostLockState(fixture);
      await fixture.lockup.aggregateProfits();
      await expect(
        fixture.lockup.aggregateProfits()
      ).to.be.revertedWithCustomError(fixture.lockup, "PayoutSafe");
    });

    it("attempts to use unlock [ @skip-on-coverage ]", async () => {
      expect(await fixture.lockup.getState()).to.be.equals(
        LockupStates.PreLock
      );
      await expect(
        fixture.lockup.unlock(ethers.constants.AddressZero, false)
      ).to.be.revertedWithCustomError(fixture.lockup, "PostLockStateRequired");
      await jumpToInlockState(fixture);
      await expect(
        fixture.lockup.unlock(ethers.constants.AddressZero, false)
      ).to.be.revertedWithCustomError(fixture.lockup, "PostLockStateRequired");
      await jumpToPostLockState(fixture);
      await expect(
        fixture.lockup.unlock(ethers.constants.AddressZero, false)
      ).to.be.revertedWithCustomError(fixture.lockup, "PayoutUnsafe");
    });
  });

  describe("Testing onlyPayoutSafe functions", async () => {
    it("attempts to use unlock [ @skip-on-coverage ]", async () => {
      await lockStakedNFT(fixture, accounts[1], stakedTokenIDs[1]);
      await jumpToPostLockState(fixture);
      await expect(
        fixture.lockup.unlock(ethers.constants.AddressZero, true)
      ).to.be.revertedWithCustomError(fixture.lockup, "PayoutUnsafe");
      await fixture.lockup.aggregateProfits();
      await expect(
        fixture.lockup.unlock(ethers.constants.AddressZero, true)
      ).to.be.revertedWithCustomError(fixture.lockup, "UserHasNoPosition");
    });
  });

  describe("Testing onlyPayoutUnSafe functions", async () => {
    it("attempts to use aggregateProfits [ @skip-on-coverage ]", async () => {
      await lockStakedNFT(fixture, accounts[1], stakedTokenIDs[1]);
      await jumpToPostLockState(fixture);
      await fixture.lockup.aggregateProfits();

      await expect(
        fixture.lockup.aggregateProfits()
      ).to.be.revertedWithCustomError(fixture.lockup, "PayoutSafe");
    });
  });
});
