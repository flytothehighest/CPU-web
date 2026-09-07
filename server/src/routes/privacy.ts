import { Router } from "express";
import { z } from "zod";
import { authForAccountDeletion } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { Errors, ok } from "../utils/response";
import { ACCOUNT_DELETION_CONFIRMATION, requestAccountDeletion, getDeletionReceipt, publicDeletionStatus, verifyDeletionForVoiceHub } from "../services/accountDeletion";
import { revokeBrowserSession } from "../services/browserSession";
import { securityRateLimit } from "../middleware/securityRateLimit";

export const privacyRouter = Router();
privacyRouter.post("/account-deletion", authForAccountDeletion, validate(z.object({ confirmation: z.literal(ACCOUNT_DELETION_CONFIRMATION), acknowledged: z.literal(true), receipt: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional() })), async (req, res, next) => {
  try {
    const result = await requestAccountDeletion(req.user!.userId, req.browserSession?.jwxtToken || String(req.headers["x-jwxt-token"] || ""), req.body.receipt);
    await revokeBrowserSession(req, res).catch(() => undefined);
    res.setHeader("Cache-Control", "no-store");
    ok(res.status(202), result);
  } catch (error) { next(error); }
});
const receiptSchema = z.object({ receipt: z.string().regex(/^[A-Za-z0-9_-]{43}$/), jobId: z.string().max(100).optional() });
privacyRouter.post("/account-deletion/status", securityRateLimit("deletion-receipt", 120, 60_000), validate(receiptSchema), async (req, res, next) => {
  try { res.setHeader("Cache-Control", "no-store"); ok(res, publicDeletionStatus(await getDeletionReceipt(req.body.receipt))); } catch (error) { next(error); }
});
privacyRouter.post("/account-deletion/verify", securityRateLimit("deletion-verify", 120, 60_000), validate(receiptSchema), async (req, res, next) => {
  try { res.setHeader("Cache-Control", "no-store"); ok(res, await verifyDeletionForVoiceHub(req.body.receipt, req.body.jobId || "")); } catch (error) { next(error); }
});
