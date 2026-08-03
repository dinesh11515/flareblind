import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const PRICE = (p: string) => ethers.parseUnits(p, 18);
const XRP = (a: string) => ethers.parseUnits(a, 6);
const USD = (a: string) => ethers.parseUnits(a, 6);

const BATCH_DURATION = 300;
const MAX_DEVIATION_BPS = 200;
const MAX_ORACLE_AGE = 600;

describe("FlareblindPool", () => {
  async function deployFixture() {
    const [owner, tee, alice, bob, carol] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const base = await MockERC20.deploy("Test FXRP", "FXRP", 6);
    const quote = await MockERC20.deploy("Test USD", "USDX", 6);

    const MockOracle = await ethers.getContractFactory("MockOracle");
    const oracle = await MockOracle.deploy();
    await oracle.set(PRICE("2.10"), await time.latest());

    const Pool = await ethers.getContractFactory("FlareblindPool");
    const pool = await Pool.deploy(
      base,
      quote,
      oracle,
      BATCH_DURATION,
      MAX_DEVIATION_BPS,
      MAX_ORACLE_AGE,
      owner.address
    );
    await pool.setTeeSigner(tee.address, ethers.id("attestation-digest"));
    await pool.setEnclaveEncryptionKey(ethers.id("enclave-x25519-pubkey"));

    for (const trader of [alice, bob, carol]) {
      await base.mint(trader.address, XRP("10000"));
      await quote.mint(trader.address, USD("50000"));
      await base.connect(trader).approve(pool, ethers.MaxUint256);
      await quote.connect(trader).approve(pool, ethers.MaxUint256);
    }

    return { pool, base, quote, oracle, owner, tee, alice, bob, carol };
  }

  async function sealedBatchFixture() {
    const ctx = await deployFixture();
    const { pool, alice, bob } = ctx;
    await pool.connect(alice).deposit(false, USD("25000"));
    await pool.connect(bob).deposit(true, XRP("5000"));
    await pool.connect(alice).submitOrder("0x1111");
    await pool.connect(bob).submitOrder("0x2222");
    await time.increase(BATCH_DURATION + 1);
    await pool.closeBatch();
    return ctx;
  }

  describe("balances", () => {
    it("credits deposits and debits withdrawals", async () => {
      const { pool, base, alice } = await loadFixture(deployFixture);
      await pool.connect(alice).deposit(true, XRP("100"));
      expect(await pool.baseBalanceOf(alice.address)).to.equal(XRP("100"));

      await expect(pool.connect(alice).withdraw(true, XRP("40")))
        .to.emit(pool, "Withdrawn")
        .withArgs(alice.address, true, XRP("40"));
      expect(await pool.baseBalanceOf(alice.address)).to.equal(XRP("60"));
      expect(await base.balanceOf(alice.address)).to.equal(XRP("9940"));
    });

    it("rejects zero amounts and over-withdrawal", async () => {
      const { pool, alice } = await loadFixture(deployFixture);
      await expect(pool.connect(alice).deposit(true, 0)).to.be.revertedWithCustomError(
        pool,
        "ZeroAmount"
      );
      await expect(
        pool.connect(alice).withdraw(true, 1)
      ).to.be.revertedWithCustomError(pool, "InsufficientVenueBalance");
    });
  });

  describe("order submission", () => {
    it("emits the sealed order with batch id and index", async () => {
      const { pool, alice } = await loadFixture(deployFixture);
      await pool.connect(alice).deposit(false, USD("100"));

      await expect(pool.connect(alice).submitOrder("0xdeadbeef"))
        .to.emit(pool, "OrderSubmitted")
        .withArgs(1n, alice.address, 0, "0xdeadbeef");
      await expect(pool.connect(alice).submitOrder("0xcafe"))
        .to.emit(pool, "OrderSubmitted")
        .withArgs(1n, alice.address, 1, "0xcafe");
    });

    it("requires a venue deposit first (spam brake)", async () => {
      const { pool, alice } = await loadFixture(deployFixture);
      await expect(
        pool.connect(alice).submitOrder("0xdeadbeef")
      ).to.be.revertedWithCustomError(pool, "DepositRequired");
    });

    it("bounds ciphertext size", async () => {
      const { pool, alice } = await loadFixture(deployFixture);
      await pool.connect(alice).deposit(false, USD("100"));
      const oversized = "0x" + "ab".repeat(513);
      await expect(
        pool.connect(alice).submitOrder(oversized)
      ).to.be.revertedWithCustomError(pool, "SealedOrderTooLarge");
      await expect(
        pool.connect(alice).submitOrder("0x")
      ).to.be.revertedWithCustomError(pool, "SealedOrderTooLarge");
    });
  });

  describe("batch lifecycle", () => {
    it("cannot close before the window elapses", async () => {
      const { pool } = await loadFixture(deployFixture);
      await expect(pool.closeBatch()).to.be.revertedWithCustomError(
        pool,
        "BatchStillOpen"
      );
    });

    it("rolls an empty batch straight to the next one", async () => {
      const { pool } = await loadFixture(deployFixture);
      await time.increase(BATCH_DURATION + 1);
      await expect(pool.closeBatch())
        .to.emit(pool, "BatchSettled")
        .withArgs(1n, 0, 0, 0);
      const [id, phase] = await pool.batchInfo();
      expect(id).to.equal(2n);
      expect(phase).to.equal(0);
    });

    it("freezes withdrawals and new orders while Sealing", async () => {
      const { pool, alice } = await loadFixture(sealedBatchFixture);
      await expect(
        pool.connect(alice).withdraw(false, USD("1"))
      ).to.be.revertedWithCustomError(pool, "WrongPhase");
      await expect(
        pool.connect(alice).submitOrder("0x3333")
      ).to.be.revertedWithCustomError(pool, "WrongPhase");
    });
  });

  describe("settlement", () => {
    it("only the attested TEE signer can settle", async () => {
      const { pool, alice } = await loadFixture(sealedBatchFixture);
      await expect(
        pool.connect(alice).settleBatch(1, PRICE("2.10"), [])
      ).to.be.revertedWithCustomError(pool, "NotTeeSigner");
    });

    it("settles a crossed batch at the clearing price", async () => {
      const { pool, tee, alice, bob } = await loadFixture(sealedBatchFixture);
      const fills = [
        { trader: alice.address, isBuy: true, baseAmount: XRP("1000") },
        { trader: bob.address, isBuy: false, baseAmount: XRP("1000") },
      ];
      await expect(pool.connect(tee).settleBatch(1, PRICE("2.10"), fills))
        .to.emit(pool, "BatchSettled")
        .withArgs(1n, PRICE("2.10"), XRP("1000"), 2);

      expect(await pool.baseBalanceOf(alice.address)).to.equal(XRP("1000"));
      expect(await pool.quoteBalanceOf(alice.address)).to.equal(USD("22900"));

      expect(await pool.baseBalanceOf(bob.address)).to.equal(XRP("4000"));
      expect(await pool.quoteBalanceOf(bob.address)).to.equal(USD("2100"));

      expect(await pool.quoteDust()).to.equal(0);

      const [id, phase] = await pool.batchInfo();
      expect(id).to.equal(2n);
      expect(phase).to.equal(0);
    });

    it("charges buyers ceil and pays sellers floor, keeping the dust", async () => {
      const { pool, quote, owner, tee, alice, bob } = await loadFixture(
        sealedBatchFixture
      );

      const fills = [
        { trader: alice.address, isBuy: true, baseAmount: 1n },
        { trader: bob.address, isBuy: false, baseAmount: 1n },
      ];
      await pool.connect(tee).settleBatch(1, PRICE("2.10"), fills);
      expect(await pool.quoteDust()).to.equal(1n);

      const before = await quote.balanceOf(owner.address);
      await pool.withdrawDust(owner.address);
      expect(await quote.balanceOf(owner.address)).to.equal(before + 1n);
      expect(await pool.quoteDust()).to.equal(0);
    });

    it("rejects unconserved volume", async () => {
      const { pool, tee, alice, bob } = await loadFixture(sealedBatchFixture);
      const fills = [
        { trader: alice.address, isBuy: true, baseAmount: XRP("100") },
        { trader: bob.address, isBuy: false, baseAmount: XRP("90") },
      ];
      await expect(
        pool.connect(tee).settleBatch(1, PRICE("2.10"), fills)
      ).to.be.revertedWithCustomError(pool, "VolumeNotConserved");
    });

    it("rejects clearing prices outside the FTSO deviation bound", async () => {
      const { pool, tee, alice, bob } = await loadFixture(sealedBatchFixture);
      const fills = [
        { trader: alice.address, isBuy: true, baseAmount: XRP("100") },
        { trader: bob.address, isBuy: false, baseAmount: XRP("100") },
      ];

      await expect(
        pool.connect(tee).settleBatch(1, PRICE("2.20"), fills)
      ).to.be.revertedWithCustomError(pool, "PriceOutOfBounds");

      await expect(pool.connect(tee).settleBatch(1, PRICE("2.13"), fills)).to.emit(
        pool,
        "BatchSettled"
      );
    });

    it("rejects a stale oracle price", async () => {
      const { pool, oracle, tee, alice, bob } = await loadFixture(sealedBatchFixture);
      await oracle.set(PRICE("2.10"), (await time.latest()) - MAX_ORACLE_AGE - 10);
      const fills = [
        { trader: alice.address, isBuy: true, baseAmount: XRP("100") },
        { trader: bob.address, isBuy: false, baseAmount: XRP("100") },
      ];
      await expect(
        pool.connect(tee).settleBatch(1, PRICE("2.10"), fills)
      ).to.be.revertedWithCustomError(pool, "StaleOraclePrice");
    });

    it("rejects fills the trader cannot fund", async () => {
      const { pool, tee, alice, bob, carol } = await loadFixture(sealedBatchFixture);

      const fills = [
        { trader: alice.address, isBuy: true, baseAmount: XRP("100") },
        { trader: carol.address, isBuy: false, baseAmount: XRP("100") },
      ];
      await expect(
        pool.connect(tee).settleBatch(1, PRICE("2.10"), fills)
      ).to.be.revertedWithCustomError(pool, "InsufficientVenueBalance");
    });

    it("settles an uncrossed batch empty, with zero price only", async () => {
      const { pool, tee } = await loadFixture(sealedBatchFixture);
      await expect(
        pool.connect(tee).settleBatch(1, PRICE("2.10"), [])
      ).to.be.revertedWithCustomError(pool, "NonZeroPriceForEmptyBatch");
      await expect(pool.connect(tee).settleBatch(1, 0, []))
        .to.emit(pool, "BatchSettled")
        .withArgs(1n, 0, 0, 0);
    });

    it("rejects settlement of a non-current batch id", async () => {
      const { pool, tee } = await loadFixture(sealedBatchFixture);
      await expect(
        pool.connect(tee).settleBatch(2, 0, [])
      ).to.be.revertedWithCustomError(pool, "BatchIdMismatch");
    });
  });

  describe("admin", () => {
    it("caps the deviation bound", async () => {
      const { pool } = await loadFixture(deployFixture);
      await expect(
        pool.setParams(1001, MAX_ORACLE_AGE, BATCH_DURATION)
      ).to.be.revertedWithCustomError(pool, "DeviationCapExceeded");
    });

    it("restricts key rotation to the owner", async () => {
      const { pool, alice } = await loadFixture(deployFixture);
      await expect(
        pool.connect(alice).setTeeSigner(alice.address, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount");
      await expect(
        pool.connect(alice).setEnclaveEncryptionKey(ethers.ZeroHash)
      ).to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount");
    });
  });
});
