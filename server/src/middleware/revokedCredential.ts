import type { Request, Response, NextFunction } from "express";
import { prisma } from "../prisma";
import { credentialHash } from "../services/accountDeletionSessions";
import { Errors } from "../utils/response";

export async function revokedCredentialGate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.browserSession?.jwxtToken || String(req.headers["x-jwxt-token"] || "");
    if (token && await prisma.accountRevokedCredential.findUnique({ where: { tokenHash: credentialHash(token) } })) throw Errors.unauthorized("该教务授权已随账户删除失效，请重新登录");
    next();
  } catch (error) { next(error); }
}
