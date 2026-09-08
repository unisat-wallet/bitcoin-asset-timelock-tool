import { Buffer } from "buffer";
import type { ToSignInput, UnisatSignInput } from "../types";
import { isLikelyHex } from "./format";

export function normalizeSignedPsbtToHex(result: string): string {
  const clean = result.trim();
  if (isLikelyHex(clean)) return clean;
  return Buffer.from(clean, "base64").toString("hex");
}

export function toUniSatSignInputs(inputs: ToSignInput[]): UnisatSignInput[] {
  return inputs.map((input) => ({
    index: input.index,
    publicKey: input.publicKey,
    disableTweakSigner:
      typeof input.useTweakedSigner === "boolean"
        ? !input.useTweakedSigner
        : undefined,
  }));
}
