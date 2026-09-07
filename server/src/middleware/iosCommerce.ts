import type { Request, Response, NextFunction } from "express";
import { Errors } from "../utils/response";

export function isIosCommerceRequest(req: Pick<Request, "headers">) {
  return /CPUWebIOSApp/i.test(String(req.headers["user-agent"] || ""))
    || String(req.headers["x-cpu-client"] || "").toLowerCase() === "ios";
}

export function iosCommerceUnavailable(req: Request, _res: Response, next: NextFunction) {
  next(isIosCommerceRequest(req) ? Errors.forbidden("iOS 客户端不提供支付或权益兑换功能") : undefined);
}
