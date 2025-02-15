import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { BigNumberish } from "ethers";
import { ethers, expect } from "hardhat";
import { getValidatorEthAccount } from "../../setup";
import { validators4 } from "../assets/4-validators-successful-case";
import {
  distributeValidatorsShares,
  getInfoForIncorrectPhaseCustomError,
  Phase,
  startAtDistributeShares,
  startAtSubmitKeyShares,
  submitValidatorsKeyShares,
  waitNextPhaseStartDelay,
} from "../setup";

describe("ETHDKG: Submit Key share", () => {
  function deployFixture() {
    return startAtSubmitKeyShares(validators4);
  }

  it("should not allow submission of key shares when not in KeyShareSubmission phase [ @skip-on-coverage ]", async () => {
    const [ethdkg, validatorPool, expectedNonce] =
      await startAtDistributeShares(validators4);
    // distribute shares for all validators
    await distributeValidatorsShares(
      ethdkg,
      validatorPool,
      validators4,
      expectedNonce
    );

    const txPromise = submitValidatorsKeyShares(
      ethdkg,
      validatorPool,
      validators4,
      expectedNonce
    );
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
          Phase.KeyShareSubmission,
          phaseStartBlock,
          phaseStartBlock.add(phaseLength),
        ],
        [
          Phase.DisputeShareDistribution,
          phaseStartBlock.add(phaseLength),
          phaseStartBlock.add(phaseLength.mul(2)),
        ],
      ]);
  });

  it("should allow submission of key shares [ @skip-on-coverage ]", async function () {
    const [ethdkg, validatorPool, expectedNonce] = await loadFixture(
      deployFixture
    );
    // Submit the Key shares for all validators
    await submitValidatorsKeyShares(
      ethdkg,
      validatorPool,
      validators4,
      expectedNonce
    );
    await waitNextPhaseStartDelay(ethdkg);
  });

  it("should not allow non-validator to submit key shares [ @skip-on-coverage ]", async function () {
    const [ethdkg, ,] = await loadFixture(deployFixture);

    // a non-validator tries to submit the Key shares
    const validator11 = "0x23EA3Bad9115d436190851cF4C49C1032fA7579A";
    // the following key shares are random
    const val11KeyShareG1: [BigNumberish, BigNumberish] = [
      "17035310766744831563591292029696192827665758482745443896273681135609364351966",
      "8801780341017589574914043621916619466439019492703882557005011145310693503950",
    ];
    const val11KeyShareG1CorrectnessProof: [BigNumberish, BigNumberish] = [
      "6543809733837281689024771115555619859286425076097977581554882983559941504331",
      "2641364196812055977500829600424881630686738586362647621109052312363561915812",
    ];
    const val11KeyShareG2: [
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish
    ] = [
      "422853908170281277163470858333106055290638104506421291199546067593853935136",
      "9467833597932378734715085763545858869972930499954379185225159397601362594154",
      "8743598319810782186450993867080805497457018022200839730580834926549940363993",
      "19522351501097379178289251110843345007238019509263663307388430690023301219325",
    ];

    await expect(
      ethdkg
        .connect(await getValidatorEthAccount(validator11))
        .submitKeyShare(
          val11KeyShareG1,
          val11KeyShareG1CorrectnessProof,
          val11KeyShareG2
        )
    )
      .to.be.revertedWithCustomError(ethdkg, "OnlyValidatorsAllowed")
      .withArgs(validator11);
  });

  it("should not allow multiple submission of key shares by the same validator [ @skip-on-coverage ]", async function () {
    const [ethdkg, validatorPool, expectedNonce] = await loadFixture(
      deployFixture
    );
    // Submit the Key shares for all validators
    await submitValidatorsKeyShares(
      ethdkg,
      validatorPool,
      validators4.slice(0, 1),
      expectedNonce
    );

    const ethDKGPhases = await ethers.getContractAt(
      "ETHDKGPhases",
      ethdkg.address
    );

    await expect(
      submitValidatorsKeyShares(
        ethdkg,
        validatorPool,
        validators4.slice(0, 1),
        expectedNonce
      )
    )
      .to.be.revertedWithCustomError(
        ethDKGPhases,
        `ParticipantSubmittedKeysharesInRound`
      )
      .withArgs(ethers.utils.getAddress(validators4[0].address));
  });

  it("should not allow submission of key shares with empty input state [ @skip-on-coverage ]", async function () {
    const [ethdkg, ,] = await loadFixture(deployFixture);

    const ethDKGPhases = await ethers.getContractAt(
      "ETHDKGPhases",
      ethdkg.address
    );

    // Submit empty Key shares for all validators
    await expect(
      ethdkg
        .connect(await getValidatorEthAccount(validators4[0].address))
        .submitKeyShare(["0", "0"], ["0", "0"], ["0", "0", "0", "0"])
    ).to.be.revertedWithCustomError(ethDKGPhases, `InvalidKeyshareG1`);

    await expect(
      ethdkg
        .connect(await getValidatorEthAccount(validators4[0].address))
        .submitKeyShare(
          validators4[0].keyShareG1,
          ["0", "0"],
          ["0", "0", "0", "0"]
        )
    ).to.be.revertedWithCustomError(ethDKGPhases, `InvalidKeyshareG1`);

    await expect(
      ethdkg
        .connect(await getValidatorEthAccount(validators4[0].address))
        .submitKeyShare(
          validators4[0].keyShareG1,
          validators4[0].keyShareG1CorrectnessProof,
          ["0", "0", "0", "0"]
        )
    ).to.be.revertedWithCustomError(ethDKGPhases, `InvalidKeyshareG2`);
  });
});
