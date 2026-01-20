import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { HelloSolana } from "../target/types/hello_solana";

describe("hello-solana", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.HelloSolana as Program<HelloSolana>;

  it("Says hello solana", async () => {
    const tx = await program.methods.hello().rpc();

    console.log("Transaction signature:", tx);
  });
});
