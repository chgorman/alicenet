import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  BaseTokensFixture,
  callFunctionAndGetReturnValues,
  getBaseTokensFixture,
  getTokenIdFromTx,
  mineBlocks,
} from "../../setup";
import {
  assertERC20Balance,
  assertPositions,
  assertTotalReserveAndZeroExcess,
  newPosition,
} from "../setup";

describe("PublicStaking: Mint and Burn", async () => {
  let fixture: BaseTokensFixture;
  let notAdminSigner: SignerWithAddress;
  let adminSigner: SignerWithAddress;

  beforeEach(async function () {
    fixture = await loadFixture(getBaseTokensFixture);
    [adminSigner, notAdminSigner] = await ethers.getSigners();
  });

  it("User should be able to mint, burn then re-mint multiple times", async function () {
    for (let i = 0; i < 10; i++) {
      await fixture.alca.approve(fixture.publicStaking.address, 1000);
      const tx = await fixture.publicStaking.connect(adminSigner).mint(1000);
      const blockNumber = BigInt(tx.blockNumber as number);
      const tokenID = await getTokenIdFromTx(tx);
      await assertPositions(
        fixture.publicStaking,
        tokenID,
        newPosition(1000n, blockNumber + 1n, blockNumber + 1n, 0n, 0n),
        adminSigner.address,
        1n,
        1000n,
        0n
      );
      await assertERC20Balance(
        fixture.alca,
        fixture.publicStaking.address,
        1000n
      );
      await mineBlocks(2n);
      const balanceBeforeUser = (
        await fixture.alca.balanceOf(adminSigner.address)
      ).toBigInt();
      const [[payoutEth, payoutALCA]] = await callFunctionAndGetReturnValues(
        fixture.publicStaking,
        "burn",
        adminSigner,
        [tokenID]
      );
      expect(payoutEth.toBigInt()).to.be.equals(0n);
      expect(payoutALCA.toBigInt()).to.be.equals(1000n);
      expect(payoutEth.toBigInt()).to.be.equals(0n);
      expect(payoutALCA.toBigInt()).to.be.equals(1000n);
      await assertERC20Balance(fixture.alca, fixture.publicStaking.address, 0n);
      await assertERC20Balance(
        fixture.alca,
        adminSigner.address,
        balanceBeforeUser + 1000n
      );
    }
  });

  it("Should not allow to burn a non-owned position", async function () {
    await fixture.alca
      .connect(adminSigner)
      .approve(fixture.publicStaking.address, 1000);
    const tx = await fixture.publicStaking.connect(adminSigner).mint(1000);
    const tokenID = await getTokenIdFromTx(tx);
    await mineBlocks(2n);
    await expect(fixture.publicStaking.connect(notAdminSigner).burn(tokenID))
      .to.be.revertedWithCustomError(
        fixture.publicStaking,
        "CallerNotTokenOwner"
      )
      .withArgs(notAdminSigner.address);
  });

  it("Should not allow to burn a position before time", async function () {
    await fixture.alca
      .connect(adminSigner)
      .approve(fixture.publicStaking.address, 1000);
    const tx = await fixture.publicStaking.connect(adminSigner).mint(1000);
    const tokenID = await getTokenIdFromTx(tx);
    await expect(
      fixture.publicStaking.connect(adminSigner).burn(tokenID)
    ).to.be.revertedWithCustomError(
      fixture.publicStaking,
      "FreeAfterTimeNotReached"
    );
  });

  it("Should not allow to burn same position more than once", async function () {
    await fixture.alca
      .connect(adminSigner)
      .approve(fixture.publicStaking.address, 1000);
    const tx = await fixture.publicStaking.connect(adminSigner).mint(1000);
    const tokenID = await getTokenIdFromTx(tx);
    await mineBlocks(2n);
    await fixture.publicStaking.connect(adminSigner).burn(tokenID);
    await mineBlocks(2n);
    await expect(
      fixture.publicStaking.connect(adminSigner).burn(tokenID)
    ).to.be.rejectedWith("ERC721: invalid token ID");
  });

  describe("Mint stakeNFT and", async () => {
    let tokenID: number;
    beforeEach(async function () {
      await fixture.alca.approve(fixture.publicStaking.address, 1000);
      const tx = await fixture.publicStaking.connect(adminSigner).mint(1000);
      const blockNumber = BigInt(tx.blockNumber as number);
      tokenID = await getTokenIdFromTx(tx);
      await assertPositions(
        fixture.publicStaking,
        tokenID,
        newPosition(1000n, blockNumber + 1n, blockNumber + 1n, 0n, 0n),
        adminSigner.address,
        1n,
        1000n,
        0n
      );
      await assertERC20Balance(
        fixture.alca,
        fixture.publicStaking.address,
        1000n
      );
    });

    it("Burn a NFT position", async function () {
      const balanceBeforeUser = (
        await fixture.alca.balanceOf(adminSigner.address)
      ).toBigInt();
      await mineBlocks(3n);
      const [[payoutEth, payoutALCA]] = await callFunctionAndGetReturnValues(
        fixture.publicStaking,
        "burn",
        adminSigner,
        [tokenID]
      );

      expect(payoutEth.toBigInt()).to.be.equals(0n);
      expect(payoutALCA.toBigInt()).to.be.equals(1000n);
      await assertERC20Balance(fixture.alca, fixture.publicStaking.address, 0n);
      await assertERC20Balance(
        fixture.alca,
        adminSigner.address,
        balanceBeforeUser + 1000n
      );
    });

    it("burnTo a NFT position", async function () {
      await assertERC20Balance(fixture.alca, notAdminSigner.address, 0n);
      const balanceBeforeUser = (
        await fixture.alca.balanceOf(adminSigner.address)
      ).toBigInt();

      await mineBlocks(3n);
      const [[payoutEth, payoutALCA]] = await callFunctionAndGetReturnValues(
        fixture.publicStaking,
        "burnTo",
        adminSigner,
        [notAdminSigner.address, tokenID]
      );

      expect(payoutEth.toBigInt()).to.be.equals(0n);
      expect(payoutALCA.toBigInt()).to.be.equals(1000n);
      await assertERC20Balance(fixture.alca, fixture.publicStaking.address, 0n);
      await assertERC20Balance(fixture.alca, notAdminSigner.address, 1000n);
      await assertERC20Balance(
        fixture.alca,
        adminSigner.address,
        balanceBeforeUser
      );
      await assertTotalReserveAndZeroExcess(fixture.publicStaking, 0n, 0n);
    });
  });

  describe("MintTo stakeNFT and", async () => {
    let tokenID: number;
    beforeEach(async function () {
      await fixture.alca.approve(fixture.publicStaking.address, 1000);
      const tx = await fixture.publicStaking
        .connect(adminSigner)
        .mintTo(notAdminSigner.address, 1000, 10);
      const blockNumber = BigInt(tx.blockNumber as number);
      tokenID = await getTokenIdFromTx(tx);
      await assertPositions(
        fixture.publicStaking,
        tokenID,
        newPosition(1000n, blockNumber + 10n, blockNumber + 1n, 0n, 0n),
        notAdminSigner.address,
        1n,
        1000n,
        0n
      );
      await assertERC20Balance(
        fixture.alca,
        fixture.publicStaking.address,
        1000n
      );
      await assertERC20Balance(fixture.alca, notAdminSigner.address, 0n);
    });
    it("Should not allow burn a NFT position before time", async function () {
      await expect(
        fixture.publicStaking.connect(notAdminSigner).burn(tokenID)
      ).to.be.revertedWithCustomError(
        fixture.publicStaking,
        "FreeAfterTimeNotReached"
      );
    });

    it("Burn a NFT position", async function () {
      const balanceBeforeUser = (
        await fixture.alca.balanceOf(adminSigner.address)
      ).toBigInt();

      await mineBlocks(11n);
      const [[payoutEth, payoutALCA]] = await callFunctionAndGetReturnValues(
        fixture.publicStaking,
        "burn",
        notAdminSigner,
        [tokenID]
      );

      expect(payoutEth.toBigInt()).to.be.equals(0n);
      expect(payoutALCA.toBigInt()).to.be.equals(1000n);
      await assertERC20Balance(fixture.alca, fixture.publicStaking.address, 0n);
      await assertERC20Balance(fixture.alca, notAdminSigner.address, 1000n);
      await assertERC20Balance(
        fixture.alca,
        adminSigner.address,
        balanceBeforeUser
      );
      await assertTotalReserveAndZeroExcess(fixture.publicStaking, 0n, 0n);
    });

    it("BurnTo a NFT position", async function () {
      const balanceBeforeUser = (
        await fixture.alca.balanceOf(adminSigner.address)
      ).toBigInt();

      await mineBlocks(11n);
      const [[payoutEth, payoutALCA]] = await callFunctionAndGetReturnValues(
        fixture.publicStaking,
        "burnTo",
        notAdminSigner,
        [adminSigner.address, tokenID]
      );

      expect(payoutEth.toBigInt()).to.be.equals(0n);
      expect(payoutALCA.toBigInt()).to.be.equals(1000n);
      await assertERC20Balance(fixture.alca, fixture.publicStaking.address, 0n);
      await assertERC20Balance(fixture.alca, notAdminSigner.address, 0n);
      await assertERC20Balance(
        fixture.alca,
        adminSigner.address,
        balanceBeforeUser + 1000n
      );
      await assertTotalReserveAndZeroExcess(fixture.publicStaking, 0n, 0n);
    });
  });
});
