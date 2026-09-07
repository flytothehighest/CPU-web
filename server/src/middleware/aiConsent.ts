import type { Request, Response, NextFunction } from "express";
import { ensureUserAiConsent } from "../services/aiConsent";

export function isAiContentWrite(method: string, path: string) {
  return ["POST", "PATCH", "PUT"].includes(method.toUpperCase())
    && /^\/api\/(?:topics\/smart-compose$|search\/assistant(?:\/|$)|direct-messages\/.*\/messages(?:\/|$))/.test(path)
    && !/\/(?:impressions|manual-review|read|history)(?:\/|$)/.test(path);
}

export async function aiConsentGate(req: Request, _res: Response, next: NextFunction) {
  try {
    if (isAiContentWrite(req.method, req.originalUrl.split("?")[0])) await ensureUserAiConsent(req.user?.userId);
    next();
  } catch (error) { next(error); }
}
