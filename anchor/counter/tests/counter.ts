import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Counter } from "../target/types/counter";
import { assert } from "chai";

describe("counter", () => {
  const provider = anchor.getProvider();
  anchor.setProvider(provider);

  const program = anchor.workspace.Counter as Program<Counter>;

  const counterKeypair = anchor.web3.Keypair.generate();

  it("Initializes the counter", async () => {
    await program.methods
      .initialize()
      .accounts({
        payer: provider.publicKey,
        counter: counterKeypair.publicKey,
      })
      .signers([counterKeypair])
      .rpc();

    const counterAccount = await program.account.counter.fetch(
      counterKeypair.publicKey
    );

    assert.equal(counterAccount.count, 0);
  });

  it("Increments the counter", async () => {
    await program.methods
      .update({ increment: {} })
      .accounts({
        counter: counterKeypair.publicKey,
      })
      .rpc();

    const counterAccount = await program.account.counter.fetch(
      counterKeypair.publicKey
    );

    assert.equal(counterAccount.count, 1);
  });

  it("Decrements the counter", async () => {
    await program.methods
      .update({ decrement: {} })
      .accounts({
        counter: counterKeypair.publicKey,
      })
      .rpc();

    const counterAccount = await program.account.counter.fetch(
      counterKeypair.publicKey
    );

    assert.equal(counterAccount.count, 0);
  });
});
