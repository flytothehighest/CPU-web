import { Router } from "express";
import { z } from "zod";
import { authRequired, authOptional, authForAccountDeletion } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { prisma } from "../prisma";
import { Errors, ok } from "../utils/response";
import { currentAiDisclosure } from "../services/aiConsent";
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
privacyRouter.get("/ai", authOptional, async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const disclosure = currentAiDisclosure();
    const user = req.user ? await prisma.user.findUnique({ where: { id: req.user.userId }, select: { aiConsentVersion: true, aiConsentAgreedAt: true } }) : null;
    ok(res, { ...disclosure, agreed: Boolean(user?.aiConsentAgreedAt && user.aiConsentVersion === disclosure.version), agreedAt: user?.aiConsentAgreedAt ?? null });
  } catch (error) { next(error); }
});
privacyRouter.post("/ai", authRequired, validate(z.object({ version: z.string(), agree: z.boolean() })), async (req, res, next) => {
  try {
    const disclosure = currentAiDisclosure();
    if (req.body.agree && (!disclosure.ready || req.body.version !== disclosure.version)) throw Errors.conflict("声明内容已更新或尚不完整，请重新读取后确认");
    await prisma.user.update({ where: { id: req.user!.userId }, data: { aiConsentVersion: req.body.agree ? disclosure.version : null, aiConsentAgreedAt: req.body.agree ? new Date() : null } });
    ok(res, { agreed: req.body.agree });
  } catch (error) { next(error); }
});
