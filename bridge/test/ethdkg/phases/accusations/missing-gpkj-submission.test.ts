import { ethers } from "hardhat";
import { getValidatorEthAccount } from "../../../setup";
import { validators4 } from "../../assets/4-validators-successful-case";
import {
  assertETHDKGPhase,
  endCurrentPhase,
  expect,
  getInfoForIncorrectPhaseCustomError,
  Phase,
  startAtGPKJ,
  submitValidatorsGPKJ,
  waitNextPhaseStartDelay,
} from "../../setup";

describe("ETHDKG: Accuse participant of not submitting GPKj", () => {
  it("allows accusation of all missing validators at once [ @skip-on-coverage ]", async () => {
    const [ethdkg, validatorPool, expectedNonce] = await startAtGPKJ(
      validators4
    );

    await submitValidatorsGPKJ(
      ethdkg,
      validatorPool,
      validators4.slice(0, 1),
      expectedNonce,
      0
    );

    await endCurrentPhase(ethdkg);
    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);

    // accuse all at once
    const missingValidators = validators4.slice(1).map((v) => v.address);
    await ethdkg.accuseParticipantDidNotSubmitGPKJ(missingValidators);

    expect(await ethdkg.getBadParticipants()).to.equal(3);
    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);

    // should not allow to finish ethdkg
    await endCurrentPhase(ethdkg);
    const txPromise = ethdkg
      .connect(await getValidatorEthAccount(validators4[0].address))
      .complete();
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
          Phase.DisputeGPKJSubmission,
          phaseStartBlock.add(phaseLength),
          phaseStartBlock.add(phaseLength.mul(2)),
        ],
      ]);
  });

  it("allows accusation of missing validators one at a time [ @skip-on-coverage ]", async () => {
    const [ethdkg, validatorPool, expectedNonce] = await startAtGPKJ(
      validators4
    );

    await submitValidatorsGPKJ(
      ethdkg,
      validatorPool,
      validators4.slice(0, 1),
      expectedNonce,
      0
    );

    await endCurrentPhase(ethdkg);
    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);

    // accuse one at a time
    let i = 1;
    for (; i < validators4.length; i++) {
      await ethdkg.accuseParticipantDidNotSubmitGPKJ([validators4[i].address]);
    }

    expect(await ethdkg.getBadParticipants()).to.equal(3);
    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);
  });

  it("should not move to next phase if there are accusations related to missing GPKj submissions [ @skip-on-coverage ]", async () => {
    const [ethdkg, validatorPool, expectedNonce] = await startAtGPKJ(
      validators4
    );

    await submitValidatorsGPKJ(
      ethdkg,
      validatorPool,
      validators4.slice(0, 1),
      expectedNonce,
      0
    );

    await endCurrentPhase(ethdkg);
    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);

    // accuse one validator only
    await ethdkg.accuseParticipantDidNotSubmitGPKJ([validators4[1].address]);

    expect(await ethdkg.getBadParticipants()).to.equal(1);
    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);

    // wait for next phase
    await endCurrentPhase(ethdkg);

    // should not allow to finish ethdkg
    const txPromise = ethdkg
      .connect(await getValidatorEthAccount(validators4[0].address))
      .complete();
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
          Phase.DisputeGPKJSubmission,
          phaseStartBlock.add(phaseLength),
          phaseStartBlock.add(phaseLength.mul(2)),
        ],
      ]);

    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);
  });

  it("should not allow accusations related to missing GPKj submissions while on GPKj submission phase [ @skip-on-coverage ]", async () => {
    const [ethdkg] = await startAtGPKJ(validators4);

    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);

    // accuse one validator only
    const txPromise = ethdkg.accuseParticipantDidNotSubmitGPKJ([
      validators4[1].address,
    ]);
    const [
      ,
      ETHDKGAccusations,
      expectedBlockNumber,
      expectedCurrentPhase,
      phaseStartBlock,
      phaseLength,
    ] = await getInfoForIncorrectPhaseCustomError(txPromise, ethdkg);
    await expect(txPromise)
      .to.be.revertedWithCustomError(ETHDKGAccusations, `IncorrectPhase`)
      .withArgs(expectedCurrentPhase, expectedBlockNumber, [
        [
          Phase.GPKJSubmission,
          phaseStartBlock.add(phaseLength),
          phaseStartBlock.add(phaseLength.mul(2)),
        ],
      ]);
  });

  it("should not allow GPKj submission after the GPKj submission phase [ @skip-on-coverage ]", async () => {
    const [ethdkg, validatorPool, expectedNonce] = await startAtGPKJ(
      validators4
    );

    await submitValidatorsGPKJ(
      ethdkg,
      validatorPool,
      validators4.slice(0, 1),
      expectedNonce,
      0
    );

    await endCurrentPhase(ethdkg);
    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);

    const txPromise = submitValidatorsGPKJ(
      ethdkg,
      validatorPool,
      validators4.slice(1, 2),
      expectedNonce,
      0
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
          Phase.GPKJSubmission,
          phaseStartBlock,
          phaseStartBlock.add(phaseLength),
        ],
      ]);

    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);
  });

  it("should not allow missing validators to complete ETHDKG after the GPKj submission phase [ @skip-on-coverage ]", async () => {
    const [ethdkg, validatorPool, expectedNonce] = await startAtGPKJ(
      validators4
    );

    await submitValidatorsGPKJ(
      ethdkg,
      validatorPool,
      validators4.slice(0, 1),
      expectedNonce,
      0
    );

    await endCurrentPhase(ethdkg);
    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);

    // should not allow finishing ethdkg
    const txPromise = ethdkg
      .connect(await getValidatorEthAccount(validators4[1].address))
      .complete();
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
          Phase.DisputeGPKJSubmission,
          phaseStartBlock.add(phaseLength),
          phaseStartBlock.add(phaseLength.mul(2)),
        ],
      ]);

    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);
  });

  it("should not allow accusation of missing GPKj to a validator that actually submitted it [ @skip-on-coverage ]", async () => {
    const [ethdkg, validatorPool, expectedNonce] = await startAtGPKJ(
      validators4
    );

    await submitValidatorsGPKJ(
      ethdkg,
      validatorPool,
      validators4.slice(0, 1),
      expectedNonce,
      0
    );

    await endCurrentPhase(ethdkg);
    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);

    const ETHDKGAccusations = await ethers.getContractAt(
      "ETHDKGAccusations",
      ethdkg.address
    );

    // accuse
    await expect(
      ethdkg.accuseParticipantDidNotSubmitGPKJ([validators4[0].address])
    )
      .to.be.revertedWithCustomError(
        ETHDKGAccusations,
        `AccusedDidNotParticipateInGPKJSubmission`
      )
      .withArgs(ethers.utils.getAddress(validators4[0].address));

    expect(await ethdkg.getBadParticipants()).to.equal(0);

    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);
  });

  it("should not allow accusation of missing GPKj to a non-existent validator [ @skip-on-coverage ]", async () => {
    const [ethdkg, validatorPool, expectedNonce] = await startAtGPKJ(
      validators4
    );

    await submitValidatorsGPKJ(
      ethdkg,
      validatorPool,
      validators4.slice(0, 1),
      expectedNonce,
      0
    );

    await endCurrentPhase(ethdkg);
    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);

    const ETHDKGAccusations = await ethers.getContractAt(
      "ETHDKGAccusations",
      ethdkg.address
    );

    // accuse
    const accusedAddress = "0x26D3D8Ab74D62C26f1ACc220dA1646411c9880Ac";
    await expect(ethdkg.accuseParticipantDidNotSubmitGPKJ([accusedAddress]))
      .to.be.revertedWithCustomError(ETHDKGAccusations, `AccusedNotValidator`)
      .withArgs(ethers.utils.getAddress(accusedAddress));

    expect(await ethdkg.getBadParticipants()).to.equal(0);

    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);
  });

  it("should not allow accusation of missing GPKj after the accusation window is over [ @skip-on-coverage ]", async () => {
    const [ethdkg, validatorPool, expectedNonce] = await startAtGPKJ(
      validators4
    );

    await submitValidatorsGPKJ(
      ethdkg,
      validatorPool,
      validators4.slice(0, 1),
      expectedNonce,
      0
    );

    await waitNextPhaseStartDelay(ethdkg);
    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);

    // accuse
    const txPromise = ethdkg.accuseParticipantDidNotSubmitGPKJ([
      validators4[1].address,
    ]);
    const [
      ,
      ETHDKGAccusations,
      expectedBlockNumber,
      expectedCurrentPhase,
      phaseStartBlock,
      phaseLength,
    ] = await getInfoForIncorrectPhaseCustomError(txPromise, ethdkg);
    await expect(txPromise)
      .to.be.revertedWithCustomError(ETHDKGAccusations, `IncorrectPhase`)
      .withArgs(expectedCurrentPhase, expectedBlockNumber, [
        [
          Phase.GPKJSubmission,
          phaseStartBlock.add(phaseLength),
          phaseStartBlock.add(phaseLength.mul(2)),
        ],
      ]);

    expect(await ethdkg.getBadParticipants()).to.equal(0);

    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);
  });

  it("should not allow accusation of missing GPKj against a list of non-participants, non-validators, and legit participants [ @skip-on-coverage ]", async () => {
    const [ethdkg, validatorPool, expectedNonce] = await startAtGPKJ(
      validators4
    );

    await submitValidatorsGPKJ(
      ethdkg,
      validatorPool,
      validators4.slice(0, 1),
      expectedNonce,
      0
    );

    const ETHDKGAccusations = await ethers.getContractAt(
      "ETHDKGAccusations",
      ethdkg.address
    );
    await endCurrentPhase(ethdkg);
    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);

    // accuse
    const addresses = validators4.map((v) => v.address);
    addresses.push("0x26D3D8Ab74D62C26f1ACc220dA1646411c9880Ac");

    await expect(ethdkg.accuseParticipantDidNotSubmitGPKJ(addresses))
      .to.be.revertedWithCustomError(
        ETHDKGAccusations,
        `AccusedDidNotParticipateInGPKJSubmission`
      )
      .withArgs(ethers.utils.getAddress(validators4[0].address));

    expect(await ethdkg.getBadParticipants()).to.equal(0);

    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);
  });

  it("should not allow double accusation of missing GPKj a non-participating validator [ @skip-on-coverage ]", async () => {
    const [ethdkg, validatorPool, expectedNonce] = await startAtGPKJ(
      validators4
    );

    const ETHDKGAccusations = await ethers.getContractAt(
      "ETHDKGAccusations",
      ethdkg.address
    );
    await submitValidatorsGPKJ(
      ethdkg,
      validatorPool,
      validators4.slice(0, 1),
      expectedNonce,
      0
    );

    await endCurrentPhase(ethdkg);
    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);
    expect(await ethdkg.getBadParticipants()).to.equal(0);

    // accuse
    await ethdkg.accuseParticipantDidNotSubmitGPKJ([validators4[1].address]);
    expect(await ethdkg.getBadParticipants()).to.equal(1);

    await expect(
      ethdkg.accuseParticipantDidNotSubmitGPKJ([validators4[1].address])
    )
      .to.be.revertedWithCustomError(ETHDKGAccusations, `AccusedNotValidator`)
      .withArgs(ethers.utils.getAddress(validators4[1].address));

    expect(await ethdkg.getBadParticipants()).to.equal(1);

    await assertETHDKGPhase(ethdkg, Phase.GPKJSubmission);
  });
});
