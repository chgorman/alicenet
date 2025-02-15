import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers, expect } from "hardhat";
import { getValidatorEthAccount } from "../../setup";
import { validators4 } from "../assets/4-validators-successful-case";
import {
  getInfoForIncorrectPhaseCustomError,
  Phase,
  startAtGPKJ,
  startAtMPKSubmission,
  submitValidatorsGPKJ,
} from "../setup";

describe("ETHDKG: GPKj submission", () => {
  it("should not allow GPKj submission outside of GPKjSubmission phase [ @skip-on-coverage ]", async () => {
    const [ethdkg] = await startAtMPKSubmission(validators4);

    const txPromise = ethdkg
      .connect(await getValidatorEthAccount(validators4[0].address))
      .submitGPKJ(validators4[0].gpkj);
    const [
      ethDKGPhases,
      ,
      expectedBlockNumber,
      expectedCurrentPhase,
      phaseStartBlock,
      phaseLength,
    ] = await getInfoForIncorrectPhaseCustomError(txPromise, ethdkg);
    await expect(txPromise)
      .to.be.revertedWithCustomError(ethDKGPhases, `IncorrectPhase`)
      .withArgs(expectedCurrentPhase, expectedBlockNumber, [
        [
          Phase.GPKJSubmission,
          phaseStartBlock,
          phaseStartBlock.add(phaseLength),
        ],
      ]);
  });

  describe("GPKj submission phase", () => {
    function deployFixture() {
      return startAtGPKJ(validators4);
    }
    it("should not allow non-validators to submit GPKj submission [ @skip-on-coverage ]", async () => {
      const [ethdkg] = await loadFixture(deployFixture);

      const validator11 = "0x23EA3Bad9115d436190851cF4C49C1032fA7579A";

      await expect(
        ethdkg
          .connect(await getValidatorEthAccount(validator11))
          .submitGPKJ(validators4[0].gpkj)
      )
        .to.be.revertedWithCustomError(ethdkg, "OnlyValidatorsAllowed")
        .withArgs(validator11);
    });

    it("should not allow submission of GPKj more than once from a validator [ @skip-on-coverage ]", async () => {
      const [ethdkg, validatorPool, expectedNonce] = await loadFixture(
        deployFixture
      );

      await submitValidatorsGPKJ(
        ethdkg,
        validatorPool,
        validators4.slice(0, 1),
        expectedNonce,
        0
      );

      const ethDKGPhases = await ethers.getContractAt(
        "ETHDKGPhases",
        ethdkg.address
      );

      await expect(
        submitValidatorsGPKJ(
          ethdkg,
          validatorPool,
          validators4.slice(0, 1),
          expectedNonce,
          0
        )
      )
        .to.be.revertedWithCustomError(
          ethDKGPhases,
          `ParticipantSubmittedGPKJInRound`
        )
        .withArgs(validators4[0].address);
    });

    it("should not allow submission of empty GPKj [ @skip-on-coverage ]", async () => {
      const [ethdkg] = await loadFixture(deployFixture);

      const ethDKGPhases = await ethers.getContractAt(
        "ETHDKGPhases",
        ethdkg.address
      );

      await expect(
        ethdkg
          .connect(await getValidatorEthAccount(validators4[0].address))
          .submitGPKJ(["0", "0", "0", "0"])
      ).to.be.revertedWithCustomError(ethDKGPhases, `GPKJZero`);
    });
  });
});
