import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Escrow } from "../target/types/escrow";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { describe } from "mocha";

describe("escrow", () => {
  const provider = anchor.getProvider();
  anchor.setProvider(provider);

  const program = anchor.workspace.Escrow as Program<Escrow>;

  const maker = anchor.web3.Keypair.generate();
  const taker = anchor.web3.Keypair.generate();
  const mintAuthority = anchor.web3.Keypair.generate();

  const SEED           = new anchor.BN(42);
  const DEPOSIT_AMOUNT = new anchor.BN(1_000_000);
  const RECEIVE_AMOUNT = new anchor.BN(2_000_000);
  const DECIMALS       = 6;

  let mintX: PublicKey;
  let mintY: PublicKey;

  let makerAtaX: PublicKey;
  let makerAtaY: PublicKey;
  let takerAtaX: PublicKey;
  let takerAtaY: PublicKey;

  let escrowPDA: PublicKey;
  let escrowBump: number;
  let vault: PublicKey;

  before(async () => {
    await provider.connection.requestAirdrop(
      maker.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      taker.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      mintAuthority.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    mintX = await createMint(
      provider.connection,
      maker,
      mintAuthority.publicKey,
      null,
      DECIMALS
    );

    mintY = await createMint(
      provider.connection,
      taker,
      mintAuthority.publicKey,
      null,
      DECIMALS
    );

    makerAtaX = await createAssociatedTokenAccount(
      provider.connection, maker, mintX, maker.publicKey
    );
    makerAtaY = await createAssociatedTokenAccount(
      provider.connection, maker, mintY, maker.publicKey
    );
    takerAtaX = await createAssociatedTokenAccount(
      provider.connection, taker, mintX, taker.publicKey
    );
    takerAtaY = await createAssociatedTokenAccount(
      provider.connection, taker, mintY, taker.publicKey
    );

    await mintTo(
      provider.connection, maker, mintX, makerAtaX,
      mintAuthority, DEPOSIT_AMOUNT.toNumber()
    );
    await mintTo(
      provider.connection, taker, mintY, takerAtaY,
      mintAuthority, RECEIVE_AMOUNT.toNumber()
    );

    const seedBuf = Buffer.alloc(8);
    seedBuf.writeBigUInt64LE(BigInt(SEED.toString()));
    [escrowPDA, escrowBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), seedBuf],
      program.programId
    );

    vault = getAssociatedTokenAddressSync(mintX, escrowPDA, true, TOKEN_PROGRAM_ID);

    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  it("Initialises escrow state and moves deposit_amount into the vault", async () => {
    await program.methods
      .make(SEED, DEPOSIT_AMOUNT, RECEIVE_AMOUNT)
      .accountsPartial({
        maker:                  maker.publicKey,
        mintX,
        mintY,
        makerAtaX,
        makerAtaY,
        escrow:                 escrowPDA,
        vault,
        systemProgram:          SystemProgram.programId,
        tokenProgram:           TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([maker])
      .rpc();

    const escrow = await program.account.escrow.fetch(escrowPDA);
    expect(escrow.seed.toString()).to.equal(SEED.toString());
    expect(escrow.maker.toBase58()).to.equal(maker.publicKey.toBase58());
    expect(escrow.mintX.toBase58()).to.equal(mintX.toBase58());
    expect(escrow.mintY.toBase58()).to.equal(mintY.toBase58());
    expect(escrow.depositAmount.toString()).to.equal(DEPOSIT_AMOUNT.toString());
    expect(escrow.receiveAmount.toString()).to.equal(RECEIVE_AMOUNT.toString());
    expect(escrow.bump).to.equal(escrowBump);

    const vaultAccount = await getAccount(provider.connection, vault);
    expect(vaultAccount.amount.toString()).to.equal(DEPOSIT_AMOUNT.toString());

    const makerX = await getAccount(provider.connection, makerAtaX);
    expect(makerX.amount.toString()).to.equal("0");
  });

  it("Should fail to make with the same seed twice", async () => {
    try {
      await program.methods
        .make(SEED, DEPOSIT_AMOUNT, RECEIVE_AMOUNT)
        .accountsPartial({
          maker:                  maker.publicKey,
          mintX,
          mintY,
          makerAtaX,
          makerAtaY,
          escrow:                 escrowPDA,
          vault,
          systemProgram:          SystemProgram.programId,
          tokenProgram:           TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([maker])
        .rpc();

      expect.fail("Expected transaction to fail");
    } catch (error: any) {
      expect(error).to.exist;
    }
  });

  it("Different seed produces a distinct escrow PDA", async () => {
    const altSeed = new anchor.BN(99);
    const altSeedBuf = Buffer.alloc(8);
    altSeedBuf.writeBigUInt64LE(BigInt(altSeed.toString()));

    const [altEscrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), altSeedBuf],
      program.programId
    );
    const altVault = getAssociatedTokenAddressSync(
      mintX, altEscrow, true, TOKEN_PROGRAM_ID
    );

    await mintTo(
      provider.connection, maker, mintX, makerAtaX,
      mintAuthority, DEPOSIT_AMOUNT.toNumber()
    );

    await program.methods
      .make(altSeed, DEPOSIT_AMOUNT, RECEIVE_AMOUNT)
      .accountsPartial({
        maker:                  maker.publicKey,
        mintX,
        mintY,
        makerAtaX,
        makerAtaY,
        escrow:                 altEscrow,
        vault:                  altVault,
        systemProgram:          SystemProgram.programId,
        tokenProgram:           TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([maker])
      .rpc();

    expect(altEscrow.toBase58()).to.not.equal(escrowPDA.toBase58());
  });

  it("Swaps tokens — mint_y from taker to maker, mint_x from vault to taker", async () => {
    const preVaultX  = await getAccount(provider.connection, vault);
    const preMakerY  = await getAccount(provider.connection, makerAtaY);
    const preTakerX  = await getAccount(provider.connection, takerAtaX);

    await program.methods
      .take()
      .accountsPartial({
        taker:                  taker.publicKey,
        mintX,
        mintY,
        takerAtaX,
        takerAtaY,
        makerAtaX,
        makerAtaY,
        escrow:                 escrowPDA,
        vault,
        tokenProgram:           TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram:          SystemProgram.programId,
      })
      .signers([taker])
      .rpc();

    const makerY = await getAccount(provider.connection, makerAtaY);
    expect(
      (makerY.amount - preMakerY.amount).toString()
    ).to.equal(RECEIVE_AMOUNT.toString());

    const takerX = await getAccount(provider.connection, takerAtaX);
    expect(
      (takerX.amount - preTakerX.amount).toString()
    ).to.equal(preVaultX.amount.toString());

    const takerY = await getAccount(provider.connection, takerAtaY);
    expect(takerY.amount.toString()).to.equal("0");
  });

  it("Vault token account is closed after take", async () => {
    const vaultInfo = await provider.connection.getAccountInfo(vault);
    expect(vaultInfo).to.be.null;
  });

  it("Escrow PDA is closed after take", async () => {
    const escrowInfo = await provider.connection.getAccountInfo(escrowPDA);
    expect(escrowInfo).to.be.null;
  });
});